import "./styles.css";
import { initImageStage } from "./modules/image-stage.js";

// Global error handlers for debugging
window.onerror = function (msg, url, lineNo, columnNo, error) {
  var string = String(msg).toLowerCase();
  if (string.indexOf("script error") > -1) {
    console.error("Script Error: See Browser Console for Detail");
  } else {
    console.error("Error: " + msg, "URL: " + url, "Line: " + lineNo, error);
  }
  return false;
};

window.addEventListener("unhandledrejection", function (event) {
  console.error("Unhandled Promise Rejection: ", event.reason);
});

initImageStage();
