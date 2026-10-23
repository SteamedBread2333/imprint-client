import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import App from "./App";

const theme = createTheme({
  primaryColor: "violet",
  defaultRadius: "md",
  fontFamily: "system-ui, sans-serif",
  fontFamilyMonospace: "ui-monospace, monospace",
  headings: { fontFamily: "system-ui, sans-serif", fontWeight: "600" },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
