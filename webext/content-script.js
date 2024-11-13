
console.log("load content script!");
const url = browser.runtime.getURL("./data/libs/freeze-dry.es.js");
import(url).then(async module => {
  console.log("freeze!");
  const html = await module.freezeDry(document, {});
  console.log("send message freeze-complete");
  browser.runtime.sendMessage({
    msg: "freeze-complete",
    result: html
  });
});

