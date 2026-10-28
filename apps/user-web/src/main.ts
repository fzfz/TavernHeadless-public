import { createApp } from "vue";
import App from "./App.vue";
import PortalApp from "./features/portal/PortalApp.vue";
import { bootstrapRoleApplication } from "./lib/bootstrap.js";
import { userError } from "./lib/errors.js";
import labels from "./config/ui.json";

const root = document.getElementById("app")!;
root.textContent = labels.loadingApplication;
bootstrapRoleApplication(new URL(window.location.href))
  .then(async (context) => {
    if (context.preview) await import("./style.css");
    else await import("./portal.css");
    createApp(context.preview ? App : PortalApp, { context }).mount(root);
  })
  .catch((error) => {
    console.error(
      "Role application startup failed",
      error instanceof Error ? error.message : String(error),
    );
    root.replaceChildren();
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = userError(error);
    const retry = document.createElement("button");
    retry.textContent = labels.retry;
    retry.onclick = () => window.location.reload();
    root.append(message, retry);
    if (
      error &&
      typeof error === "object" &&
      "adminBaseUrl" in error &&
      typeof error.adminBaseUrl === "string"
    ) {
      const link = document.createElement("a");
      link.href = error.adminBaseUrl;
      link.textContent = labels.returnAdmin;
      root.append(link);
    }
  });
