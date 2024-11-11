console.log("[Dimi]devtools-opener.js\n");

browser.devtools.panels
  .create(
    "Autofill", // title
    "./icons/icon.svg", // icon
    "./devtools-panel.html", // content
  )
  .then((newPanel) => {
    newPanel.onShown.addListener(panelShown);
    newPanel.onHidden.addListener(panelHidden);
  });


function panelShown() {
  console.log("[Dimi]Panel is shown");
  browser.runtime.sendMessage({
    msg: "show",
    tabId: browser.devtools.inspectedWindow.tabId,
  });
}

function panelHidden() {
  console.log("[Dimi]Panel is hidden");
  browser.runtime.sendMessage({
    msg: "hide",
    tabId: browser.devtools.inspectedWindow.tabId,
  });
}
