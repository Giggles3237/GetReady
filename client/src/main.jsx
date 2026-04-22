import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.jsx";
import "./styles.css";

document.documentElement.classList.toggle("native-shell", Capacitor.isNativePlatform());

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
