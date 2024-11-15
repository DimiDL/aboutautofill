const BUGZILLA_NEW_BUG_URL = "https://bugzilla.mozilla.org/enter_bug.cgi?product=Toolkit&component=Form+Autofill";

/**
 * Utility Functions
 */
async function getHostNameByTabId(tabId) {
  const tab = await browser.tabs.get(tabId);
  const urlObj = new URL(tab.url);
  return urlObj.hostname;
}

function dataURLToBlob(url) {
  const binary = atob(url.split(",", 2)[1]);
  let contentType = url.split(",", 1)[0];
  contentType = contentType.split(";", 1)[0];
  contentType = contentType.split(":", 2)[1];

  if (contentType !== "image/png" && contentType !== "image/jpeg") {
    contentType = "image/png";
  }
  const data = Uint8Array.from(binary, char => char.charCodeAt(0));
  const blob = new Blob([data], { type: contentType });
  return blob;
}


function download(blob, filename, saveAs = true) {
  const url = URL.createObjectURL(blob);

  // Trigger download with a save-as dialog
  browser.downloads.download({
    url: url,
    filename: filename,
    saveAs
  }).then(() => {
    console.log("Download triggered successfully.");
    URL.revokeObjectURL(url); // Clean up the Blob URL after download
  }).catch((error) => {
    // Dimi: Users cancel, just ignore it
    console.error("Error triggering download:", error);
  });
}

/**
 * Inspector Panel View Related
 */
function scrollIntoView(tabId, inspectId, frameId) {
  browser.scripting.executeScript({
    target: {
      tabId,
      frameIds: [frameId],
    },
    func: (inspectId) => {
      const selector = `[data-moz-autofill-inspect-id="${inspectId}"]`;
      const element = document.querySelector(selector);
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const isInViewport = (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
      );

      if (!isInViewport) {
        element.scrollIntoView({behavior: 'smooth', block: 'center', inline: 'nearest'});
      }
    },
    args: [inspectId]
  });
}

async function addHighlightOverlay({ tabId, type, inspectId, frameId }) {
  browser.scripting.executeScript({
    target: {
      tabId,
      frameIds: [frameId],
    },
    func: (type, inspectId) => {
      const color = type == 'select' ? 'blue' : 'red';
      const bgColor = type == 'select' ? 'rgba(0, 0, 255, 0.2)' : 'rgba(255, 0, 0, 0.2)';
      const zIndex = type == 'select' ? 9999 : 9998;

      const selector = `[data-moz-autofill-inspect-id="${inspectId}"]`;
      const element = document.querySelector(selector);
      if (!element) {
        return;
      }

      const highlightOverlay = document.createElement("div");
      highlightOverlay.classList.add("moz-autofill-overlay");
      highlightOverlay.id = `moz-${type}-highlight-overlay-${inspectId}`;
      document.body.appendChild(highlightOverlay);

      Object.assign(highlightOverlay.style, {
        position: "absolute",
        backgroundColor: `${bgColor}`,
        border: `2px solid ${color}`,
        zIndex: zIndex,
        pointerEvents: "none",
      });

      const rect = element.getBoundingClientRect();
      highlightOverlay.style.top = rect.top + window.scrollY + 'px';
      highlightOverlay.style.left = rect.left + window.scrollX + 'px';
      highlightOverlay.style.width = rect.width + 'px';
      highlightOverlay.style.height = rect.height + 'px';
    },
    args: [type, inspectId]
  });
}

async function removeAllHighlightOverlay(tabId) {
  const frames = await browser.webNavigation.getAllFrames({ tabId });
  browser.scripting.executeScript({
    target: {
      tabId,
      frameIds: [...frames.map(frame => frame.frameId)],
    },
    func: () => {
      const overlays = document.querySelectorAll('div.moz-autofill-overlay');
      overlays.forEach(element => element.remove());
    }
  });
}

async function removeHighlightOverlay(tabId, type, inspectId, frameId) {
  browser.scripting.executeScript({
    target: {
      tabId,
      frameIds: [frameId],
    },
    func: (type, inspectId) => {
      const overlay = document.getElementById(`moz-${type}-highlight-overlay-${inspectId}`);
      overlay?.remove();
    },
    args: [type, inspectId]
  });
}

async function freezePage(tabId) {
  const urlToPath = new Map();
  const pages = [];
  let frames = await browser.webNavigation.getAllFrames({ tabId });
  const mainFrame = frames.find(frame => frame.parentFrameId == -1);
  const iframes = frames.filter(frame => frame.parentFrameId == mainFrame.frameId);

  frames = [...iframes, mainFrame];

  for (let idx = 0; idx < frames.length; idx++) {
    const frame = frames[idx];
    const promise = new Promise((resolve) => {
      function waitForFreeze(request, sender, sendResponse) {
        if (request.msg === "freeze-complete") {
          resolve(request.result);
          browser.runtime.onMessage.removeListener(waitForFreeze);
        }
      }
      browser.runtime.onMessage.addListener(waitForFreeze);
    });

    browser.scripting.executeScript({
      target: {
        tabId,
        frameIds: [frame.frameId],
      },
      files: ["/content/content-script.js"],
    });
    let html = await promise;

    let filename;
    if (idx == frames.length - 1) {
      filename = `${new URL(frame.url).host}.html`;
      for (let [url, path] of urlToPath) {
        url = url.replace(/&/g, "&amp;");
        //console.log("url is " + url);
        const regexURL = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<iframe\\s+[^>]*src=["']${regexURL}["']`, 'i');
        //if (html.match(regex)) {
          //console.log("ok..can find with regex");
        //} else {
          //console.log("ok..canNOT find with regex");
        //}
        //if (html.includes(url)) {
          //console.log("ok..can find with include");
        //} else {
          //console.log("ok..canNOT find with include");
        //}
        html = html.replace(regex, `<iframe src="${path}"`);
      }
    } else {
      filename = `${new URL(frame.url).host}/${idx}.html`;
      urlToPath.set(frame.url, filename);
      //continue;
    }
    pages.push({
      filename,
      blob: new Blob([html], { type: 'text/html' }),
    })
  }

  return pages;
}

function generateTest(template, inspectResult, host) {
  const filename = `"${host}.html"`;
  let text = template.replace("{{filename}}", filename);
  let formattedJson = JSON.stringify(inspectResult, null, 2);
  formattedJson = formattedJson.replace(/^/gm, ' '.repeat(6));
  text = text.replace("{{expectedResult}}", formattedJson);
  text = text.replace("{{filePath}}", `"fixtures/third_party/${host}/"`);
  return text;
}

async function screenshotPage(tabId, x, y, width, height) {
  const dataUrl = await browser.experiments.autofill.captureTab(
    tabId,
    x,
    y,
    width,
    height,
  );
  return dataURLToBlob(dataUrl);
}

function changeFieldAttribute({ tabId, inspectId, frameId, attribute, value }) {
  browser.scripting.executeScript({
    target: {
      tabId,
      frameIds: [frameId],
    },
    func: (inspectId, attribute, value) => {
      const selector = `[data-moz-autofill-inspect-id="${inspectId}"]`;
      const element = document.querySelector(selector);
      if (!element) {
        return;
      }
      const originalValue = element.getAttribute(attribute);
      element.setAttribute(attribute, value)
      element.setAttribute(`data-moz-autofill-inspector-change-${attribute}`, originalValue)
    },
    args: [inspectId, attribute, value]
  });

}

/**
 * When we receive the message, execute the given script in the given tab.
 */
async function handleMessage(request, sender, sendResponse) {
  console.log("receive msg " + request.msg + "");
  switch (request.msg) {
    // Run autofill fields inspection
    case "inspect": {
      await removeAllHighlightOverlay(request.tabId);
      const result = await browser.experiments.autofill.inspect(request.tabId);
      browser.runtime.sendMessage({
        msg: 'inspect-complete',
        tabId: request.tabId,
        data: result
      }).catch(() => {});
      break;
    }
    // Download the page mark
    case "freeze": {
      const host = await getHostNameByTabId(request.tabId);

      const url = browser.runtime.getURL("/libs/jszip.js");
      import(url).then(async module => {
        const zip = JSZip();
        const pages = await freezePage(request.tabId);
        for (const page of pages) {
          zip.file(page.filename, page.blob);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        download(blob, `testcase-${host}.zip`);
      });
      break;
    }
    // Generate a testcase
    case "generate-testcase": {
      const host = await getHostNameByTabId(request.tabId);

      const url = browser.runtime.getURL("/libs/jszip.js");
      import(url).then(async module => {
        const dir = `test-${host}`;
        const zip = JSZip();

        // Testcase
        const testcase = generateTest(request.template, request.result, host);
        zip.file(`${dir}/${host}.js`, testcase);

        // Web Page Freezed Markup
        const pages = await freezePage(request.tabId);
        for (const page of pages) {
          zip.file(page.filename, page.blob);
        }

        // Web Page Screenshot
        const screenBlob = await screenshotPage(
          request.tabId,
          request.x,
          request.y,
          request.width,
          request.height
        );
        zip.file(`${dir}/${host}.png`, screenBlob);

        const blob = await zip.generateAsync({ type: "blob" });
        download(blob, `${host}.zip`);
      });
      break;
    }
    // Screenshot the tab
    case "screenshot": {
      const blob = await screenshotPage(
        request.tabId,
        request.x,
        request.y,
        request.width,
        request.height
      );

      const host = await getHostNameByTabId(request.tabId);
      download(blob, `dom-${host}.png`);
      break;
    }
    // File a Site Compatibility Bug Report
    case "report": {
      // TODO: Need attachmenbt, url, summary, and description
      browser.tabs.create({
        url: BUGZILLA_NEW_BUG_URL
      });
      break;
    }
    // Add Test Records to show in the autocomplete dropdown
    case "set-test-records": {
      await browser.experiments.autofill.setTestRecords(
        request.tabId,
        request.records
      );
      break;
    }
    case "change-field-attribute": {
      changeFieldAttribute(request);
      break;
    }
    case "download": {
      const blob = dataURLToBlob(request.dataUrl);
      download(blob, request.filename)
      break;
    }
    case "hide": {
      await removeAllHighlightOverlay(request.tabId);
      break;
    }
    /**
     * Autofill Inspector Panel Commands
     */
    case "scroll": {
      scrollIntoView(
        request.tabId,
        request.inspectId,
        request.frameId
      );
      break;
    }
    case "highlight": {
      addHighlightOverlay(request);
      break;
    }
    case "highlight-remove": {
      removeHighlightOverlay(
        request.tabId,
        request.type,
        request.inspectId,
        request.frameId
      );
      break;
    }
  }
}

/**
 * Listen for messages from our devtools panel.
 * */
browser.runtime.onMessage.addListener(handleMessage);
