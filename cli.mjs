#!/usr/bin/env node
/**
 * dsh-forge CLI —— 与插件工具同源，便于在终端里直接试、也便于排查。
 *
 *   node cli.mjs verticals [--kind store|company]
 *   node cli.mjs build --project "老王烧烤" --vertical 餐饮 --out ./out [--site laowang]
 *   node cli.mjs prd   --project "老王烧烤" --vertical 餐饮 --out ./out
 *   node cli.mjs deploy --dir ./out/laowang --site laowang [--dry-run] [--rollback]
 *   node cli.mjs sites
 */
import { join, resolve } from 'node:path'
import {
  loadVerticals, findVertical, customVertical, renderPRD, renderDemo, writeProject,
  projectManifest, deploy, listSites, slugify, stamp,
} from './lib/core.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}
const has = name => argv.includes(`--${name}`)

function resolveVertical(name, modules) {
  if (!name && !modules) return loadVerticals()[0]
  return findVertical(name) ?? customVertical({ label: name, modules })
}

async function main() {
  if (!cmd || cmd === 'help') {
    console.log(`dsh-forge — PRD + Demo + 阿里云部署

  verticals  [--kind store|company]          列出行业字典
  build      --project 名称 --vertical 餐饮 [--modules "A,B,C"] [--site 站点名] [--out 目录]
  prd        --project 名称 --vertical 餐饮 [--out 目录]
  deploy     --dir 目录 --site 站点名 [--dry-run] [--rollback] [--host aliyun]
  sites      [--host aliyun]                 列出已部署站点`)
    return
  }

  if (cmd === 'verticals') {
    const kind = flag('kind')
    const rows = loadVerticals().filter(v => !kind || v.kind === kind)
    for (const v of rows) {
      console.log(`${v.id.padEnd(14)} ${v.kind === 'store' ? '门店' : '公司'}  ${v.label}（${v.subtitle}）`)
      console.log(`${''.padEnd(14)} 模块：${v.modules.map(m => m.name).join(' / ')}`)
    }
    console.log(`\n共 ${rows.length} 个业态（全量 ${loadVerticals().length}）。加行业 = 加一行 ${'data/industries.json'}。`)
    return
  }

  if (cmd === 'build' || cmd === 'prd') {
    const project = flag('project')
    if (!project) throw new Error('缺少 --project')
    const v = resolveVertical(flag('vertical'), flag('modules'))
    const site = flag('site') ?? (slugify(project) || `${v.id}-${stamp()}`)
    const outRoot = resolve(flag('out') ?? join(process.cwd(), 'out'))
    const dir = join(outRoot, site)

    const prd = renderPRD({ project, vertical: v, features: null })
    const files = { 'prd.md': prd.md, 'prd.html': prd.html }

    if (cmd === 'build') {
      const demo = renderDemo({ project, vertical: v, tagline: `${v.label} · ${v.persona}` })
      files['console/index.html'] = demo.console
      files['h5/index.html'] = demo.h5
    }
    files['manifest.json'] = projectManifest({ project, v, site, dir })

    writeProject({ dir, files })
    console.log(`✓ 生成 ${dir}`)
    for (const f of Object.keys(files)) console.log(`  · ${f}`)
    console.log(`\n本地预览：  open "${join(dir, 'console', 'index.html')}"`)
    console.log(`部署：      node cli.mjs deploy --dir "${dir}" --site ${site}`)
    return
  }

  if (cmd === 'deploy') {
    const dir = flag('dir')
    const site = flag('site')
    if (!dir || !site) throw new Error('缺少 --dir 或 --site')
    const result = deploy({
      dir, site,
      host: flag('host') ?? 'aliyun',
      dryRun: has('dry-run'),
      rollback: has('rollback'),
      publicHost: flag('public-host'),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (cmd === 'sites') {
    const sites = listSites({ host: flag('host') ?? 'aliyun' })
    console.log(sites.length ? sites.join('\n') : '（还没有站点）')
    return
  }

  throw new Error(`未知命令：${cmd}`)
}

main().catch(error => { console.error('✗', error.message); process.exit(1) })
