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

function download(blob, filename) {
  const url = URL.createObjectURL(blob);

  // Trigger download with a save-as dialog
  browser.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  }).then(() => {
    console.log("Download triggered successfully.");
    URL.revokeObjectURL(url); // Clean up the Blob URL after download
  }).catch((error) => {
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
  console.log("[Dimi]receive url from " + sender.url + " with msg " + request.msg + ", target tab is " + request.tabId);
  switch (request.msg) {
    case "inspect": {
      const result = await browser.aboutautofill.inspect(request.tabId);
      browser.runtime.sendMessage({
        type: 'refresh',
        tabId: request.tabId,
        data: result
      }).catch(() => {});
      break;
    }
    case "freeze": {
      // TODO: Only executeScript when we have done it before
      const results = await browser.scripting.executeScript({
        target: { tabId: request.tabId },
        files: ["./webext/content-script.js"],
      });
      break;
    }
    case "freeze-complete": {
      const urlObj = new URL(sender.url);
      const filename = `freeze-${urlObj.hostname}.html`;
      const html = request.result;
      const blob = new Blob([html], { type: 'text/html' });
      download(blob, filename);
      break;
    }
    case "screenshot": {
      const tab = await browser.tabs.get(request.tabId);
      const urlObj = new URL(tab.url);
      const filename = `dom-${urlObj.hostname}.png`;
      const dataUrl = await browser.tabs.captureTab(request.tabId, {rect: request.rect});
      const blob = dataURLToBlob(dataUrl);
      download(blob, filename);
      break;
    }
    case "export-inspect": {
      const tab = await browser.tabs.get(request.tabId);
      const urlObj = new URL(tab.url);
      const filename = `inspect-${urlObj.hostname}.png`;
      const dataUrl = await browser.aboutautofill.test();
      const blob = dataURLToBlob(dataUrl);
      download(blob, filename);
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
      console.log(`[Dimi]records: ${JSON.stringify(request.records)}`);
      await browser.aboutautofill.setTestRecords(request.tabId, request.records);
      break;
    }
  }
  //console.log("[Dimi]receive url from " + sender.url + "with result: " + JSON.stringify(result));

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
