import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div className="relative min-h-screen">
      <div className="bg-shift absolute inset-0 -z-10"></div>
      <App />
    </div>
  </React.StrictMode>
);
