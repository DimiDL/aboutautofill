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
        browser.aboutautofill.inspect(tab.id, info.targetElementId);
        break;
      default:
        break;
    }
  });

  browser.aboutautofill.startup();
});

// onStartup is called at browser startup if the addon is already installed.
browser.runtime.onStartup.addListener(() => {
  browser.aboutautofill.startup();
});

/**
 * When we receive the message, execute the given script in the given tab.
 */
async function handleMessage(request, sender, sendResponse) {
  console.log("[Dimi]receive url from " + sender.url + " with msg " + request.msg);
  if (request.msg == "screenshot") {
    browser.aboutautofill.test();
    return;
  }
  const result = await browser.aboutautofill.inspect(request.tabId);
  console.log("[Dimi]receive url from " + sender.url + "with result: " + JSON.stringify(result));

  // Should i use browser.tabs.sendMessage
  browser.runtime.sendMessage({type: 'refresh', tabId: request.tabId, data: result}).catch(() => {});
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
