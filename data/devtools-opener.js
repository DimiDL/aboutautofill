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
}

function panelHidden() {
  console.log("[Dimi]Panel is hidden");
}
