const BUGZILLA_NEW_BUG_URL = "https://bugzilla.mozilla.org/enter_bug.cgi?product=Toolkit&component=Form+Autofill";

/**
 * Utility Functions
 */
async function getHostNameByTabId(tabId) {
  const tab = await browser.tabs.get(tabId);
  const urlObj = new URL(tab.url);
  return urlObj.hostname;
}

async function loadData(filename) {
  try {
    const url = browser.runtime.getURL(filename);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Network response was not ok " + response.statusText);
    }

    let data;
    const extension = url.split('.').pop().toLowerCase();
    if (extension === "json") {
      data = await response.json();
    } else {
      data = await response.text();
    }
    return data;
  } catch (error) {
    console.error("Failed to load JSON data:", error);
  }
}

async function getTestAddresses() {
  return await loadData("data/test-addresses.json");
}

async function getTestCreditCards() {
  return await loadData("data/test-credit-cards.json");
}

async function getTestTemplate() {
  return await loadData("data/gecko-autofill-test-template.js");
}

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
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

function download(filename, blob, saveAs = true) {
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

        // Ensure we can load iframe in test
        html = html.replace(`frame-src`, `frame-src 'self'`);

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

async function generateTest(host, inspectResult) {
  //const filename = `browser_${host.replace(/\./g, '_')}.js`;
  const filename = `test/${host}.json`;

  const text = JSON.stringify(inspectResult, null, 2);

  const template = await getTestTemplate();
  //let text = template.replace("{{filename}}", filename);
  //let formattedJson = JSON.stringify(inspectResult, null, 2);
  //formattedJson = formattedJson.replace(/^/gm, ' '.repeat(6));
  //text = text.replace("{{expectedResult}}", formattedJson);
  //text = text.replace("{{filePath}}", `"fixtures/third_party/${host}/"`);
  return { filename, blob: text };
}

async function screenshotPage(tabId, host) {
  const filename = `screenshot-${host}.png`;

  const [{result}] = await browser.scripting.executeScript({
    target: { tabId },
    func: () => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }),
  });

  const dataUrl =
    await browser.experiments.autofill.captureTab(tabId, 0, 0, result.width, result.height);
  const blob = dataURLToBlob(dataUrl);
  return { filename, blob };
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

const WEB_PAGE = 0x01;
const GECKO_TEST = 0x02;
const PAGE_SCREENSHOT = 0x04;

async function createReport(tabId, type, { zip = true, wantDownload = true, inspectResult = null }) {
  const host = await getHostNameByTabId(tabId);

  const files = [];
  if (type & WEB_PAGE) {
    const pages = await freezePage(tabId);
    if (zip) {
      pages.forEach(page => {
        page.filename = `page/${page.filename}`;
      });
    }
    files.push(...pages);
  }

  if (type & GECKO_TEST) {
    const testcase = await generateTest(host, inspectResult);
    files.push(testcase);
  }

  if (type & PAGE_SCREENSHOT) {
    const screenshot = await screenshotPage(tabId, host);
    files.push(screenshot);
  }

  if (zip) {
    const url = browser.runtime.getURL("/libs/jszip.js");
    await import(url);
    const zip = JSZip();
    for (const file of files) {
      zip.file(file.filename, file.blob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    if (wantDownload) {
      download(`report-${host}.zip`, blob);
    }
    return blob;
  } else {
    if (wantDownload) {
      for (const file of files) {
        download(file.filename, file.blob);
      }
    } else {
      return files;
    }
  }
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
      createReport(request.tabId, WEB_PAGE, { zip: true });
      break;
    }
    // Generate a testcase
    case "generate-testcase": {
      createReport(
        request.tabId,
        PAGE_SCREENSHOT | WEB_PAGE | GECKO_TEST,
        { zip: true, inspectResult: request.inspectResult }
      );
      break;
    }
    // Screenshot the tab
    case "screenshot": {
      createReport(request.tabId, PAGE_SCREENSHOT, { zip: false });
      break;
    }
    // File a Site Compatibility Bug Report
    case "report": {
      const host = await getHostNameByTabId(request.tabId);
      // TODO: Need attachmenbt, url, summary, and description
      browser.tabs.create({url: BUGZILLA_NEW_BUG_URL}, (tab) => {
        browser.tabs.onUpdated.addListener(async function listener(tabId, changeInfo) {
          if (tabId != tab.id) {
            return;
          }

          console.log("[Dimi]onUpdated input " + changeInfo.status);
          if (changeInfo.status != "complete") {
            return;
          }

          const blob = await createReport(
            request.tabId,
            PAGE_SCREENSHOT | WEB_PAGE | GECKO_TEST,
            { zip: true, wantDownload: false, inspectResult: request.inspectResult }
          );
          const arrayBuffer = await blobToArrayBuffer(blob);
          const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

          browser.scripting.executeScript({
            target: {
              tabId: tab.id,
            },
            func: (host, base64ZipContent) => {
              const input = document.getElementById("bug_file_loc");
              if (input) {
                input.value = `https://${host}`;
              }
              const btn = document.getElementById("attach-new-file");
              if (btn) {
                btn.click();
              }
              const file = document.getElementById("att-file");
              if (file) {
                const binaryString = atob(base64ZipContent);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                const zipBlob = new Blob([bytes], { type: "application/zip" });
                const testFile= new File([zipBlob], "uploaded.zip", { type: "application/zip" });
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(testFile);

                // Assign the files to the input
                file.files = dataTransfer.files;
                const event = new Event("change", { bubbles: true });
                file.dispatchEvent(event);

                console.log("File uploaded successfully:", file.files[0].name);
              }
              console.log("[Dimi]set <<")
            },
            args: [host, base64]
          });

          // Remove the listener after injection
          browser.tabs.onUpdated.removeListener(listener);
        });
      });
      break;
    }
    // Add Test Records to show in the autocomplete dropdown
    case "set-test-records": {
      const records = [];
      if (request.address) {
        const addresses = await getTestAddresses();
        records.push(...addresses);
      };

      if (request.creditcard) {
        const creditcards = await getTestCreditCards();
        records.push(...creditcards);
      }

      browser.experiments.autofill.setTestRecords(request.tabId, records);
      break;
    }
    case "change-field-attribute": {
      changeFieldAttribute(request);
      break;
    }
    case "download": {
      const blob = dataURLToBlob(request.dataUrl);
      download(request.filename, blob)
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
