import { createPinia } from "pinia";
import { createApp, defineAsyncComponent, h } from "vue";
import { modelCallUi } from "@tavern/shared";
import roleAppsUi from "./config/role-apps.json";
import { nativeCardEditorConfig } from "./features/native-card-editor/config.js";
import { i18n } from "./i18n";
import "./style.css";

const root =
  window.location.pathname === modelCallUi.detailPath
    ? defineAsyncComponent(() => import("./pages/GenerationDetailView.vue"))
    : window.location.pathname === nativeCardEditorConfig.path
      ? defineAsyncComponent(
          () => import("./features/native-card-editor/NativeCardEditorPage.vue"),
        )
    : window.location.pathname === roleAppsUi.path
      ? defineAsyncComponent(() => import("./pages/RoleAppsView.vue"))
      : {
          render: () =>
            h("main", [
              h("h1", roleAppsUi.pageNotFound),
              h("a", { href: roleAppsUi.path }, roleAppsUi.returnHome),
            ]),
        };

createApp(root).use(createPinia()).use(i18n).mount("#app");
