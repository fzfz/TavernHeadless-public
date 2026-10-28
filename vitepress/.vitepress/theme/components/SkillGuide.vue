<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
import client from '../../../../.agents/skills/tavern-client-integration/references/workflow.json'
import contributing from '../../../../.agents/skills/tavern-project-contributing/references/workflow.json'
import checks from '../../../../docs/agents/development-checks.json'

const props = defineProps<{ skillId: string }>()
const workflow = computed(() => [client, contributing].find(item => item.skillId === props.skillId)!)
const command = (key: string) => checks[key as keyof typeof checks]
</script>

<template>
  <p>{{ workflow.summary }}</p>
  <h2>适用任务</h2>
  <ul><li v-for="item in workflow.recommendedWhen" :key="item">{{ item }}</li></ul>
  <h2>其他任务入口</h2>
  <ul><li v-for="item in workflow.avoidWhen" :key="item">{{ item }}</li></ul>
  <h2>决策规则</h2>
  <ul><li v-for="item in workflow.decisionRules" :key="item.title"><strong>{{ item.title }}：</strong>{{ item.rule }}</li></ul>
  <h2>工作流</h2>
  <ol><li v-for="item in workflow.workflow" :key="item.step">{{ item.action }}</li></ol>
  <h2>本仓库检查命令</h2>
  <p>下表从项目检查配置读取命令。其他客户端由任务提供相应命令表。</p>
  <table>
    <thead><tr><th>命令</th><th>适用条件</th></tr></thead>
    <tbody><tr v-for="item in workflow.checks" :key="item.command + item.purpose"><td><code>{{ command(item.command) }}</code></td><td>{{ item.purpose }}</td></tr></tbody>
  </table>
  <h2>相关入口</h2>
  <ul><li v-for="item in workflow.relatedDocs" :key="item.path"><a :href="withBase('/' + item.path)">{{ item.title }}</a></li></ul>
  <p><a :href="withBase('/' + workflow.json)">查看发布工作流 JSON</a>；核对日期：{{ workflow.lastReviewedAt }}。</p>
</template>
