<script setup lang="ts">
import { useData, withBase } from "vitepress";
import projectSite from "../../../../docs/provenance/site.json";
const { theme } = useData();
</script>

<template>
  <aside class="project-notice" aria-label="文档版本">
    <p>
      本文档由
      <a :href="`https://github.com/${projectSite.repository}`">{{
        projectSite.repository
      }}</a>
      维护，描述本仓库的设计与实现。 上游来源：<a
        :href="projectSite.upstreamSiteUrl"
        >{{ projectSite.upstreamRepository }}</a
      >（MIT）。
    </p>
    <p>
      构建提交：<a
        :href="`https://github.com/${projectSite.repository}/commit/${theme.projectVersion.commit}`"
        >{{ theme.projectVersion.commit }}</a
      >。
      {{
        theme.projectVersion.dirty
          ? "本次构建包含工作区未提交改动。"
          : "本次构建使用已提交源码。"
      }}
      {{
        theme.projectVersion.conclusion === "success"
          ? "该提交的 CI 已通过。"
          : "本次构建尚未核实 CI 结果。"
      }}
      <a :href="withBase('/development/local-development')"
        >查看本仓库开发入口</a
      >
    </p>
  </aside>
</template>

<style scoped>
.project-notice {
  max-width: 1152px;
  margin: 24px auto;
  padding: 16px 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.project-notice p {
  margin: 4px 0;
}
.project-notice a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
}
</style>
