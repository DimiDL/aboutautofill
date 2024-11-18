const BUGZILLA_NEW_BUG_URL = "https://bugzilla.mozilla.org/enter_bug.cgi?product=Toolkit&component=Form+Autofill";

/**
 * Utility Functions
 */
function fieldDetailsToTestExpectedResult(fieldDetails) {
  let expectedSection;
  const sections = [];
  let formIndex;
  let sectionIndex;
  for (const fieldDetail of fieldDetails) {
    if (!fieldDetail.fieldName || (!fieldDetail.isVisible && fieldDetail.localName == "input")) {
      continue;
    }

    if (fieldDetail.formIndex != formIndex ||
        fieldDetail.sectionIndex != sectionIndex) {
      formIndex = fieldDetail.formIndex;
      sectionIndex = fieldDetail.sectionIndex;

      expectedSection = {
        fields: [],
      };
      sections.push(expectedSection);
    }
    let expectedField = {
      fieldName: fieldDetail.fieldName,
      reason: fieldDetail.reason,
    };
    if (fieldDetail.part) {
      expectedField.part = fieldDetail.part;
    }
    expectedSection.fields.push(expectedField);
  }
  return sections;
}

async function getHostNameByTabId(tabId) {
  const tab = await browser.tabs.get(tabId);
  const urlObj = new URL(tab.url);
  return urlObj.hostname;
}

async function loadData(filename, type = null) {
  try {
    const url = browser.runtime.getURL(filename);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Network response was not ok " + response.statusText);
    }

    let data;
    const extension = url.split('.').pop().toLowerCase();
    if (type == "blob") {
      data = await response.blob();
    } else if (extension === "json") {
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

async function addHighlightOverlay(tabId, type, fieldDetails) {
  const frames = await browser.webNavigation.getAllFrames({ tabId });
  for (const frame of frames) {
    const inspectIds = fieldDetails
      .filter(fd => fd.frameId == frame.frameId)
      .map(fd => fd.inspectId);
    browser.scripting.executeScript({
      target: {
        tabId,
        frameIds: [frame.frameId],
      },
      func: (type, inspectIds) => {
        inspectIds.forEach(inspectId => {
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

          const BORDER = 2;
          Object.assign(highlightOverlay.style, {
            position: "absolute",
            backgroundColor: `${bgColor}`,
            border: `${BORDER}px solid ${color}`,
            zIndex: zIndex,
            pointerEvents: "none",
          });

          const rect = element.getBoundingClientRect();
          highlightOverlay.style.top = rect.top + window.scrollY - BORDER + 'px';
          highlightOverlay.style.left = rect.left + window.scrollX - BORDER + 'px';
          highlightOverlay.style.width = rect.width + 'px';
          highlightOverlay.style.height = rect.height + 'px';
        });
      },
      args: [type, inspectIds]
    });
  }
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

async function removeHighlightOverlay(tabId, type, fieldDetails) {
  const frames = await browser.webNavigation.getAllFrames({ tabId });
  for (const frame of frames) {
    const inspectIds = fieldDetails
      .filter(fd => fd.frameId == frame.frameId)
      .map(fd => fd.inspectId);
    browser.scripting.executeScript({
      target: {
        tabId,
        frameIds: [frame.frameId],
      },
      func: (type, inspectIds) => {
        inspectIds.forEach(inspectId => {
          const overlay = document.getElementById(`moz-${type}-highlight-overlay-${inspectId}`);
          overlay?.remove();
        });
      },
      args: [type, inspectIds]
    });
  }
}

/**
 * Remove attributes we have set for inspector before saving the page, which includes:
 * - data-moz-autofill-inspect-id
 * - data-moz-autofill-inspector-change
 *
 * We will save additional attribte - `data-moz-autofill-type` so we can use this
 * for ML training
 */
async function beforeFreeze(tabId, frames, fieldDetails) {
  const result = [];
  for (const frame of frames) {
    const detectFields = fieldDetails
      .filter(fieldDetail => fieldDetail.frameId == frame.frameId)
      .map(fieldDetail => [fieldDetail.inspectId, fieldDetail.fieldName]);

    const ret = await browser.scripting.executeScript({
      target: {
        tabId,
        frameIds: [frame.frameId]
      },
      func: (detectFields) => {
        for (const detectField of detectFields) {
          const selector = `[data-moz-autofill-inspect-id="${detectField[0]}"]`;
          const element = document.querySelector(selector);
          element?.setAttribute("data-moz-autofill-type", detectField[1]);
        }
        const ret = {};
        const temporary = `data-moz-autofill-inspector-change`;
        const elements = document.querySelectorAll(`[${temporary}`);
        for (const element of elements) {
          const inspectId = element.getAttribute(`data-moz-autofill-inspect-id`);
          ret[inspectId] = {};

          let originalAttributes = JSON.parse(element.getAttribute(temporary));
          for (const [k, v] of Object.entries(originalAttributes)) {
            ret[inspectId][k] = element.getAttribute(k);
            element.setAttribute(k, v);
          }
          element.removeAttribute(temporary);
        }
        return ret;
      },
      args: [detectFields]
    });
    result.push(ret[0]);
  }
  return result;
}

async function freezePage(tabId, fieldDetails) {
  const urlToPath = new Map();
  const pages = [];
  let frames = await browser.webNavigation.getAllFrames({ tabId });
  const mainFrame = frames.find(frame => frame.parentFrameId == -1);
  const iframes = frames.filter(frame => frame.parentFrameId == mainFrame.frameId);

  frames = [...iframes, mainFrame];

  // We want the store web page containing the original data so
  // restore attributes we changed before saving the web page.
  // However, we also want to "restore" the values we set after downloading
  // it. To do that, we keep what we changed and restore them in the end of
  // this function.
  const changedAttributes = await beforeFreeze(tabId, frames, fieldDetails);

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
        // Replace iframe src=url to point to local file
        const regexURL = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let regex = new RegExp(`<iframe\\s+[^>]*src=["']${regexURL}["']`, 'i');
        html = html.replace(regex, `<iframe src="${path}"`);

        // Add `self` to frame-src  Content Script PolicyEnsure to ensure we can load
        // iframe with local file
        html = html.replace(`frame-src`, `frame-src 'self'`);

        // Remove attributes that are used by inspector
        regex = /data-moz-autofill-inspect-id="\{[^}]*\}"/g;
        html = html.replace(regex, '');
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

  for (const { frameId, result } of changedAttributes) {
    for (const [inspectId, attributes] of Object.entries(result)) {
      for (const [k, v] of Object.entries(attributes)) {
        await changeFieldAttribute(tabId, inspectId, frameId, k, v);
      }
    }
  }

  return pages;
}

async function generateTest(host, fieldDetails) {
  const inspectResult = fieldDetailsToTestExpectedResult(fieldDetails);
  //const filename = `browser_${host.replace(/\./g, '_')}.js`;
  const filename = `test/${host}.json`;

  const text = JSON.stringify(inspectResult, null, 2);

  //const template = await getTestTemplate();
  //let text = template.replace("{{filename}}", filename);
  //let formattedJson = JSON.stringify(inspectResult, null, 2);
  //formattedJson = formattedJson.replace(/^/gm, ' '.repeat(6));
  //text = text.replace("{{expectedResult}}", formattedJson);
  //text = text.replace("{{filePath}}", `"fixtures/third_party/${host}/"`);
  return { filename, blob: text };
}

async function screenshotPage(tabId) {
  const [{result}] = await browser.scripting.executeScript({
    target: { tabId },
    func: () => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }),
  });

  const dataUrl =
    await browser.experiments.autofill.captureTab(tabId, 0, 0, result.width, result.height);
  return dataURLToBlob(dataUrl);
}

async function changeFieldAttribute(tabId, inspectId, frameId, attribute, newValue) {
  await browser.scripting.executeScript({
    target: {
      tabId,
      frameIds: [frameId],
    },
    func: (inspectId, attribute, newValue) => {
      const selector = `[data-moz-autofill-inspect-id="${inspectId}"]`;
      const element = document.querySelector(selector);
      if (!element) {
        return;
      }
      const temporary = `data-moz-autofill-inspector-change`;
      // Keep the original attribute in a temporary data-attribute
      let originalAttributes = element.getAttribute(temporary);
      originalAttributes = JSON.parse(originalAttributes) ?? {};

      // If attribute exists, it means we have already changed this attribute.
      // Do not overwrite its original value
      if (!originalAttributes.hasOwnProperty(attribute)) {
        originalAttributes[attribute] = element.getAttribute(attribute);
        element.setAttribute(temporary, JSON.stringify(originalAttributes));
      }


      // Update the attribute
      element.setAttribute(attribute, newValue)
    },
    args: [inspectId, attribute, newValue]
  });
}

const WEB_PAGE = 0x01;
const GECKO_TEST = 0x02;
const PAGE_SCREENSHOT = 0x04;
const INSPECT_EXPORT = 0x08;

async function createReport(tabId, type, { zip = true, panelBlob = null, saveAs = true, fieldDetails = null}) {
  const host = await getHostNameByTabId(tabId);

  const files = [];
  if (type & WEB_PAGE) {
    const pages = await freezePage(tabId, fieldDetails);
    if (zip) {
      pages.forEach(page => {
        page.filename = `page/${page.filename}`;
      });
    }
    files.push(...pages);
  }

  if (type & GECKO_TEST) {
    const testcase = await generateTest(host, fieldDetails);
    files.push(testcase);

    const blob = await loadData("data/gen-test.py", "blob");
    files.push({
      filename: `gen-test.py`,
      blob
    });
  }

  if (type & PAGE_SCREENSHOT) {
    const blob = await screenshotPage(tabId);
    files.push({
      filename: `screenshot-${host}.png`,
      blob,
    });
  }

  if (type & INSPECT_EXPORT) {
    files.push({
      filename: `inspect-${host}.png`,
      blob: panelBlob,
    });
  }

  if (zip) {
    const url = browser.runtime.getURL("/libs/jszip.js");
    await import(url);
    const zip = JSZip();
    for (const file of files) {
      zip.file(file.filename, file.blob);
    }
    const prefix = type == WEB_PAGE ? "page" : "report";
    const blob = await zip.generateAsync({ type: "blob" });
      download(`${prefix}-${host}.zip`, blob, saveAs);
  } else {
    for (const file of files) {
      download(file.filename, file.blob, saveAs);
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
      createReport(request.tabId, WEB_PAGE, { zip: true, fieldDetails: request.fieldDetails});
      break;
    }
    // Generate a report with everything
    case "generate-report": {
      const panelBlob = dataURLToBlob(request.panelDataUrl);
      createReport(
        request.tabId,
        PAGE_SCREENSHOT | WEB_PAGE | GECKO_TEST | INSPECT_EXPORT,
        { zip: true, panelBlob, fieldDetails: request.fieldDetails }
      );
      break;
    }
    case "export-inspect": {
      // Screenshot the tab and Sceenshot the autofill inspect panel
      const panelBlob = dataURLToBlob(request.panelDataUrl);
      createReport(request.tabId, PAGE_SCREENSHOT | INSPECT_EXPORT, { zip: false, panelBlob, saveAs: request.saveAs});
      break;
    }
    // File a Site Compatibility Bug Report
    case "report": {
      const host = await getHostNameByTabId(request.tabId);

      await createReport(
        request.tabId,
        PAGE_SCREENSHOT | WEB_PAGE | GECKO_TEST,
        { zip: true, fieldDetails: request.fieldDetails }
      );

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

          browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // Function to create and show the dialog
              function showDialog(message) {
                // Create a dialog element
                const dialog = document.createElement('dialog');
                dialog.id = 'moz-autofill-inspector-dialog';
                dialog.style.width = '300px';
                dialog.style.padding = '20px';
                dialog.style.border = '1px solid #ccc';
                dialog.style.borderRadius = '8px';
                dialog.style.boxShadow = '0px 4px 8px rgba(0, 0, 0, 0.2)';
                dialog.style.fontFamily = 'Arial, sans-serif';
                dialog.style.textAlign = 'center';
                dialog.style.zIndex = '9999';

                // Add a message
                const statusMessage = document.createElement('p');
                statusMessage.id = 'dialog-status-message';
                statusMessage.textContent = message;
                dialog.appendChild(statusMessage);

                // Add the dialog to the document
                document.body.appendChild(dialog);

                // Show the dialog
                dialog.showModal();
                dialog.offsetHeight;

                return dialog; // Return the dialog element for later use
              }

              function updateDialogText(dialog, newMessage) {
                const statusMessage = dialog.querySelector('#dialog-status-message');
                if (statusMessage) {
                  statusMessage.textContent = newMessage;
                }
              }

              const dialog = showDialog("Filling Information for you...");
            },
          });

          browser.scripting.executeScript({
            target: {
              tabId: tab.id,
            },
            func: (host) => {
              const input = document.getElementById("bug_file_loc");
              if (input) {
                input.value = `https://${host}`;
              }
              const btn = document.getElementById("attach-new-file");
              if (btn) {
                btn.click();
              }

              const dialog = document.getElementById('moz-autofill-inspector-dialog');
              dialog?.close();
              dialog?.remove();
            },
            args: [host]
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
      changeFieldAttribute(
        request.tabId,
        request.inspectId,
        request.frameId,
        request.attribute,
        request.value
      );
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
      addHighlightOverlay(
        request.tabId,
        request.type,
        request.fieldDetails
      );
      break;
    }
    case "highlight-remove": {
      removeHighlightOverlay(
        request.tabId,
        request.type,
        request.fieldDetails
      );
      break;
    }
  }
}

/**
 * Listen for messages from our devtools panel.
 * */
browser.runtime.onMessage.addListener(handleMessage);
