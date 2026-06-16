import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import outputs from "../amplify_outputs.json";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { authComponents } from "./AuthBranding";
import "./index.css";

Amplify.configure(outputs);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Authenticator signUpAttributes={["email"]} components={authComponents}>
      <App />
    </Authenticator>
  </React.StrictMode>
);
