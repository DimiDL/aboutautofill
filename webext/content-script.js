
console.log("load content script!");
const url = browser.runtime.getURL("./data/libs/freeze-dry.es.js");
import(url).then(async module => {
  if (window.top != window.self) {
    console.log("freeze in iframe!" + window.location.href);
  } else {
    console.log("freeze in main frame!" + window.location.href);
  }
  const html = await module.freezeDry(document, {});

  browser.runtime.sendMessage({
    msg: "freeze-complete",
    result: html,
    frameIdentifier: window.location.href,
  });
});

