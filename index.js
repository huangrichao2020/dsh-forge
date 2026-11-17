/**
 * dsh-forge —— PRD + Demo（工作台/H5）+ 阿里云部署 一条龙。
 *
 * 三个工具背后是 lib/core.mjs，与 cli.mjs 完全同源，所以终端里能跑通的，
 * 模型在会话里也能跑通。
 */
import { join, resolve } from 'node:path'
import {
  loadVerticals, findVertical, customVertical,
  renderPRD, renderDemo, writeProject, projectManifest,
  deploy, listSites, slugify, stamp,
} from './lib/core.mjs'

const text = value => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
const out = { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(v) }

function resolveVertical(name, modules) {
  if (!name && !modules) return loadVerticals()[0]
  return findVertical(name) ?? customVertical({ label: name, modules })
}

export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'forge:how-to',
    order: 780,
    text: [
      '做业务系统相关交付时优先用 dsh-forge，不要从零手写页面：',
      '1) 明确业态（门店：餐饮/美业/教培/零售/汽修/宠物/诊所/健身/母婴/药房；公司：贸易/制造/建筑/律所/代账/物流/中介/设计/电商/人力）。',
      '2) forge_build 一次产出 PRD（md+html）、PC 工作台、移动端 H5，纯静态无需构建。',
      '3) forge_deploy 用 rsync 走 `ssh aliyun` 别名发布到 nginx，返回公网地址；失败先看 steps 里哪一步红。',
      '4) 业态不在字典里时，仍可传 vertical=名称 + modules 自定义模块，不要拒答。',
      '产物是可交付的演示骨架：接后端时替换页面里的静态数据即可，不要在演示里假装已有真实接口。',
    ].join('\n'),
  })

  ctx.tools.register({
    name: 'forge_verticals',
    description: '列出 dsh-forge 支持的行业业态（143 个：78 门店 + 65 公司），含每个业态的模块矩阵。加行业=加一行数据，见 data/industries.json。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['store', 'company'], description: '只看门店或只看公司' },
        query: { type: 'string', description: '按名称模糊过滤，如 餐饮、律所' },
      },
      additionalProperties: false,
    },
    output: out,
    async execute({ kind, query }) {
      let rows = loadVerticals()
      if (kind) rows = rows.filter(v => v.kind === kind)
      if (query) {
        const q = String(query).toLowerCase()
        rows = rows.filter(v => v.label.includes(q) || v.id.includes(q) || v.subtitle.includes(q))
      }
      return {
        total: rows.length,
        verticals: rows.map(v => ({
          id: v.id, kind: v.kind, label: v.label, subtitle: v.subtitle,
          persona: v.persona, kpis: v.kpis, modules: v.modules.map(m => m.name),
        })),
      }
    },
  })

  ctx.tools.register({
    name: 'forge_build',
    description: '为一个业态生成完整 Demo 包：PRD（Markdown+HTML）+ PC 工作台 + 移动端 H5，纯静态、无外链、可直接部署。返回本地路径与预览方式。',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '项目/品牌名，如「老王烧烤」' },
        vertical: { type: 'string', description: '业态名或 id，如 餐饮 / restaurant；也可填字典外的自定义业态' },
        modules: { type: 'string', description: '字典外业态的自定义模块，逗号分隔，如 "点单,库存,报表"' },
        site: { type: 'string', description: '输出目录名/站点名，小写字母数字中划线；不填自动生成' },
        outDir: { type: 'string', description: '输出根目录，默认 ./out' },
        surface: { type: 'string', enum: ['both', 'console', 'h5'], description: '只生成工作台或只生成 H5，默认 both' },
      },
      required: ['project'],
      additionalProperties: false,
    },
    output: out,
    async execute({ project, vertical, modules, site, outDir, surface = 'both' }) {
      const v = resolveVertical(vertical, modules)
      const slug = site ?? (slugify(project) || `${v.id}-${stamp()}`)
      const root = resolve(outDir ?? join(process.cwd(), 'out'))
      const dir = join(root, slug)

      const prd = renderPRD({ project, vertical: v })
      const files = { 'prd.md': prd.md, 'prd.html': prd.html }
      if (surface !== 'h5') {
        const demo = renderDemo({ project, vertical: v, tagline: `${v.label} · ${v.persona}` })
        files['console/index.html'] = demo.console
      }
      if (surface !== 'console') {
        const demo = renderDemo({ project, vertical: v, tagline: `${v.label} · ${v.persona}` })
        files['h5/index.html'] = demo.h5
      }
      files['manifest.json'] = projectManifest({ project, v, site: slug, dir })
      writeProject({ dir, files })

      return {
        ok: true, site: slug, dir,
        vertical: { id: v.id, label: v.label, kind: v.kind },
        files: Object.keys(files),
        prdSections: prd.sectionCount,
        preview: { console: join(dir, 'console', 'index.html'), h5: join(dir, 'h5', 'index.html'), prd: join(dir, 'prd.html') },
        next: `forge_deploy 传 dir=${dir} site=${slug}`,
      }
    },
  })

  ctx.tools.register({
    name: 'forge_deploy',
    description: '把生成好的静态目录发布到阿里云 nginx（走本机 `ssh <host>` 别名，无需在代码里存密钥）。只写 /www/wwwroot/forge/<site>/，不改动任何既有站点；自动备份上一版并生成站点索引页。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '要发布的本地目录（forge_build 的 dir 返回值）' },
        site: { type: 'string', description: '站点名（小写字母/数字/中划线）' },
        host: { type: 'string', description: 'SSH 别名，默认 aliyun' },
        dryRun: { type: 'boolean', description: '只打印将执行的命令，不落地' },
        rollback: { type: 'boolean', description: '回滚到上一次部署' },
      },
      required: ['dir', 'site'],
      additionalProperties: false,
    },
    output: out,
    async execute({ dir, site, host = 'aliyun', dryRun = false, rollback = false }) {
      try {
        return deploy({ dir, site, host, dryRun, rollback })
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
  })

  ctx.tools.register({
    name: 'forge_sites',
    description: '列出已发布到阿里云 nginx 的 forge 站点。',
    parameters: {
      type: 'object',
      properties: { host: { type: 'string', description: 'SSH 别名，默认 aliyun' } },
      additionalProperties: false,
    },
    output: out,
    async execute({ host = 'aliyun' }) {
      try {
        const sites = listSites({ host })
        return { host, total: sites.length, sites }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
  })
}
