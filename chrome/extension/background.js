import { portName, MESSAGE_TYPES } from "./lib/port";
import _ from "lodash";
import S3Upload from "react-s3-uploader/s3upload";
const bluebird = require("bluebird");

const SCREENSHOT_CONTENT_TYPE = "image/png";

global.Promise = bluebird;

const buildURL = path => {
  return `http://localhost:3001${path}`;
};

const toBlob = base64String => {
  return window.fetch(base64String).then(res => res.blob());
};

const toFile = async base64String => {
  const blob = await toBlob(base64String);

  Object.defineProperty(blob, "name", {
    get: function() {
      return "photo.png";
    }
  });

  Object.defineProperty(blob, "type", {
    get: function() {
      return SCREENSHOT_CONTENT_TYPE;
    }
  });

  return blob;
};

const uploaders = {};

const apiFetch = (path, options = {}) => {
  return window
    .fetch(buildURL(path), {
      ...options,
      credentials: "include",
      headers: {
        ...(options.headers || {}),
        "User-Agent": `StyleURL v${chrome.app.getDetails().version} (${
          process.env.NODE_ENV
        })`,
        "Content-Type": "application/json"
      }
    })
    .then(response => response.json())
    .catch(error => {
      console.error(error);
      return {
        success: false
      };
    });
};

const uploadStylesheets = async ({ stylesheets, url }) => {
  return apiFetch("/api/stylesheet_groups", {
    method: "POST",
    body: JSON.stringify({
      url,
      stylesheets
    })
  });
};

const processScreenshot = ({
  key: stylesheet_key,
  domain: stylesheet_domain
}) => ({ publicUrl: url }) => {
  return apiFetch("/api/photos/process", {
    method: "POST",
    body: JSON.stringify({
      url,
      stylesheet_key,
      stylesheet_domain,
      content_type: SCREENSHOT_CONTENT_TYPE
    })
  }).then(() => {
    delete uploaders[stylesheet_key];
  });
};

const uploadScreenshot = ({ key, domain, photo }) => {
  uploaders[key] = new S3Upload({
    files: [photo],
    signingUrl: "/api/photos/presign",
    onFinishS3Put: processScreenshot({ key, domain }),
    onError: error => {
      console.error(error);
      delete uploaders[key];
    },
    server: "http://localhost:3001",
    uploadRequestHeaders: {}
  });
};

const getTab = tabId =>
  new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, resolve);
  });

const handleMessage = (request, sender, sendResponse) => {
  if (!request.type) {
    console.error(
      "[background] request type must be one of",
      _.values(MESSAGE_TYPES)
    );
    return;
  }

  if (request.type === MESSAGE_TYPES.get_gist_content) {
    if (!request.url) {
      console.error("[background] invalid get_gist_content: missing url");
      sendResponse({ success: false });
      return true;
    }

    window
      .fetch(request.url, {
        redirect: "follow",
        credentials: "include"
      })
      .then(response => response.text())
      .then(content => {
        sendResponse({
          type: MESSAGE_TYPES.get_gist_content,
          url: request.url,
          response: true,
          content
        });
      });

    return true;
  }

  if (!request.response) {
    console.info("[background] ignoring request that is not a response");
  }

  if (request.type === MESSAGE_TYPES.get_styles_diff) {
    console.log("[background] REceived styles!");

    getTab(request.tabId)
      .then(tab => {
        if (!tab || !tab.url) {
          alert("Something didnt work quite right. Please try again!");
          return Promise.reject();
        }

        return uploadStylesheets({
          stylesheets: request.value.stylesheets,
          url: tab.url
        });
      })
      .then(stylesheetResponse => {
        if (stylesheetResponse.success) {
          chrome.tabs.captureVisibleTab(null, { format: "png" }, async function(
            photo
          ) {
            chrome.tabs.create({ url: stylesheetResponse.data.url });
            // Capturing the photo fails sometimes shrug
            if (photo) {
              uploadScreenshot({
                photo: await toFile(photo),
                key: stylesheetResponse.data.id,
                domain: stylesheetResponse.data.domain
              });
            }
          });
        } else {
          alert("Something didnt work quite right. Please try again!");
        }
      });
  }
};

const ports = {};

chrome.runtime.onConnect.addListener(function(port) {
  ports[port.name] = port;

  console.log("NEW PORT", port.name);
  port.onMessage.addListener(handleMessage);
});

const createStyleURL = tab => {
  const port = ports[portName(tab.id)];

  if (!port) {
    alert("Please open devtools and try again");
    return;
  }

  port.postMessage({ type: MESSAGE_TYPES.get_styles_diff }, handleMessage);
};

chrome.browserAction.onClicked.addListener(createStyleURL);
chrome.runtime.onMessage.addListener(handleMessage);
