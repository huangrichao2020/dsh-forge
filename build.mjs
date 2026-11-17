#!/usr/bin/env node
/**
 * forge 构建脚本 —— 只做本地生成，不联网、不发布。
 *
 *   node build.mjs verticals [--kind store|company] [--query 关键词]
 *   node build.mjs build --project "老王烧烤" --vertical 火锅 [--site laowang] [--out ./out]
 *   node build.mjs prd   --project "老王烧烤" --vertical 火锅 [--out ./out]
 *
 * 产物：<out>/<site>/{prd.md, prd.html, console/index.html, h5/index.html, manifest.json}
 */
import { join, resolve } from 'node:path'
import {
  loadVerticals, findVertical, customVertical, renderPRD, renderDemo,
  writeProject, projectManifest, slugify, stamp,
} from './lib/core.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

function resolveVertical(name, modules) {
  if (!name && !modules) return loadVerticals()[0]
  return findVertical(name) ?? customVertical({ label: name, modules })
}

function usage() {
  console.log(`forge —— 千行百业 PRD + 工作台 + H5 生成器

  verticals [--kind store|company] [--query 关键词]   列行业与模块矩阵
  build     --project 名称 --vertical 行业 [--modules "A,B,C"] [--site 目录名] [--out 目录]
  prd       --project 名称 --vertical 行业 [--out 目录]   只出 PRD

示例：
  node build.mjs verticals --kind store
  node build.mjs build --project "老王烧烤" --vertical 火锅 --site laowang
  node build.mjs build --project "社区牙科" --vertical "口腔门诊" --modules "患者档案,预约,收费,复诊"`)
}

function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') { usage(); return }

  if (cmd === 'verticals') {
    const kind = flag('kind')
    const query = flag('query')
    let rows = loadVerticals()
    if (kind) rows = rows.filter(v => v.kind === kind)
    if (query) {
      const q = String(query)
      rows = rows.filter(v => v.label.includes(q) || v.id.includes(q) || v.subtitle.includes(q))
    }
    for (const v of rows) {
      console.log(`${v.id.padEnd(16)} ${v.kind === 'store' ? '门店' : '公司'}  ${v.label}（${v.subtitle}）`)
      console.log(`${''.padEnd(16)} ${v.persona} / ${v.kpis.join('、')}`)
      console.log(`${''.padEnd(16)} 模块：${v.modules.map(m => m.name).join(' / ')}`)
    }
    console.log(`\n共 ${rows.length} 个（全部 ${loadVerticals().length} 个）。加行业见 references/industries.md。`)
    return
  }

  if (cmd === 'build' || cmd === 'prd') {
    const project = flag('project')
    if (!project || project === true) throw new Error('缺少 --project')
    const v = resolveVertical(flag('vertical'), flag('modules'))
    const site = flag('site') ?? (slugify(project) || `${v.id}-${stamp()}`)
    const root = resolve(flag('out') ?? join(process.cwd(), 'out'))
    const dir = join(root, site)

    const prd = renderPRD({ project, vertical: v })
    const files = { 'prd.md': prd.md, 'prd.html': prd.html }

    if (cmd === 'build') {
      const demo = renderDemo({ project, vertical: v, tagline: `${v.label} · ${v.persona}` })
      files['console/index.html'] = demo.console
      files['h5/index.html'] = demo.h5
    }
    files['manifest.json'] = projectManifest({ project, v, site, dir })

    writeProject({ dir, files })
    console.log(`✓ ${project} · ${v.label}（${v.modules.length} 个模块）`)
    console.log(`  ${dir}`)
    for (const f of Object.keys(files)) console.log(`  · ${f}`)
    console.log(`\n打开：open "${join(dir, 'console', 'index.html')}"`)
    return
  }

  throw new Error(`未知命令：${cmd}（试 node build.mjs help）`)
}

try { main() } catch (error) { console.error('✗', error.message); process.exit(1) }
