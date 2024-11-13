// onInstalled, but not onStartup, is called when the addon is installed.
browser.runtime.onInstalled.addListener(() => {
  if (!browser.aboutautofill) {
    // no browser.aboutautofill almost certainly means Firefox didn't load our
    // "experimental api", so make noise.
    let msg = "\n\n***** NOTE: about:autofill is going to fail to load ****\n" +
              "If you are running this extension locally, it looks alot like you" +
              " need to set the preference `extensions.experiments.enabled` to `true`" +
              " before things will work for you. Note that this preference can" +
              " only be changed in Nightly\n\n";
    console.error(msg);
    dump(msg);
  }

  browser.contextMenus.create(
    {
      id: "inspect-autofill",
      title: "Inspect Autofill",
      contexts: ["editable"],
    },
  );

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    switch (info.menuItemId) {
      case "inspect-autofill":
        browser.aboutautofill.test();
        break;
      default:
        break;
    }
  });
});

// onStartup is called at browser startup if the addon is already installed.
browser.runtime.onStartup.addListener(() => {
});

async function refresh({ tabId }) {
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

function scrollIntoView({ tabId, inspectId, frameId }) {
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

async function removeHighlightOverlay({ tabId, type, inspectId, frameId }) {
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

let gPendingFreezeEvents = [];
async function freezePage(tabId) {
  const promise = new Promise((resolve, reject) => {
    gPendingFreezeEvents.push(resolve);
  });

  browser.scripting.executeScript({
    target: { tabId },
    files: ["./webext/content-script.js"],
  });

  const html = await promise;
  return new Blob([html], { type: 'text/html' });
}

function generateTest(template, inspectResult, host) {
  const fileName = `"${host}.html"`;
  let text = template.replace("{{fileName}}", fileName);
  let formattedJson = JSON.stringify(inspectResult, null, 2);
  formattedJson = formattedJson.replace(/^/gm, ' '.repeat(6));
  text = text.replace("{{expectedResult}}", formattedJson);
  text = text.replace("{{filePath}}", `"fixtures/third_party/${host}/"`);
  return text;
}

async function screenshotPage(tabId, x, y, width, height) {
  const dataUrl = await browser.aboutautofill.test(
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

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);

  // Trigger download with a save-as dialog
  browser.downloads.download({
    url: url,
    filename: fileName,
    saveAs: true
  }).then(() => {
    console.log("Download triggered successfully.");
    URL.revokeObjectURL(url); // Clean up the Blob URL after download
  }).catch((error) => {
    // Dimi: Users cancel, just ignore it
    console.error("Error triggering download:", error);
  });
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

/**
 * When we receive the message, execute the given script in the given tab.
 */
async function handleMessage(request, sender, sendResponse) {
  console.log("receive msg " + request.msg + "");
  switch (request.msg) {
    case "hide": {
      await refresh(request);
      break;
    }
    case "inspect": {
      await refresh(request);
      const result = await browser.aboutautofill.inspect(request.tabId);
      browser.runtime.sendMessage({
        msg: 'inspect_complete',
        tabId: request.tabId,
        data: result
      }).catch(() => {});
      break;
    }
    case "scroll": {
      scrollIntoView(request);
      break;
    }
    case "highlight": {
      addHighlightOverlay(request);
      break;
    }
    case "highlight-remove": {
      removeHighlightOverlay(request);
      break;
    }
    case "freeze": {
      if (gPendingFreezeEvents.length) {
        console.log("There is a ongoing freeze task");
        break;
      }
      const tab = await browser.tabs.get(request.tabId);
      const urlObj = new URL(tab.url);
      const fileName = `freeze-${urlObj.hostname}.html`;

      const blob = await freezePage(request.tabId);
      download(blob, fileName);
      break;
    }
    case "freeze-complete": {
      const resolve = gPendingFreezeEvents.pop();
      dump("[Dimi]resolve " + resolve + "\n");
      resolve?.(request.result);
      break;
    }
    case "generate-testcase": {
      const tab = await browser.tabs.get(request.tabId);
      const urlObj = new URL(tab.url);
      const host = urlObj.hostname;

      const url = browser.runtime.getURL("./data/libs/jszip.js");
      import(url).then(async module => {
        const jszip = JSZip();

        const dir = `test-${host}`;
        const zip = JSZip();

        // Testcase
        const testcase = generateTest(request.template, request.result, host);
        zip.file(`${dir}/${host}.js`, testcase);

        // Web Page Freezed Markup
        const pageBlob = await freezePage(request.tabId);
        zip.file(`${dir}/${host}.html`, pageBlob);

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
    case "screenshot": {
      const tab = await browser.tabs.get(request.tabId);
      const urlObj = new URL(tab.url);
      const fileName = `dom-${urlObj.hostname}.png`;
      const blob = await screenshotPage(
        request.tabId,
        request.x,
        request.y,
        request.width,
        request.height
      );

      download(blob, fileName);
      break;
    }
    case "report": {
      // Need attachmenbt, url, summary, and description
      browser.tabs.create({
        url: "https://bugzilla.mozilla.org/enter_bug.cgi?product=Toolkit&component=Form+Autofill"
      });
      break;
    }
    case "set-test-records": {
      await browser.aboutautofill.setTestRecords(request.tabId, request.records);
      break;
    }
    case "change-field-attribute": {
      changeFieldAttribute(request);
      break;
    }
    case "download": {
      const blob = dataURLToBlob(request.dataUrl);
      download(blob, request.fileName)
      break;
    }
  }

  // Should i use browser.tabs.sendMessage
  //if (sender.url != browser.runtime.getURL("/devtools/panel/panel.html")) {
    //return;
  //}

  //browser.tabs.executeScript(
    //request.tabId,
    //{
      //code: request.script
    //});
}

/**
 * Listen for messages from our devtools panel.
 * */
browser.runtime.onMessage.addListener(handleMessage);
