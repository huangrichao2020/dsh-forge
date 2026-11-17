/**
 * forge core —— 行业组合 / PRD 生成 / Demo 生成。
 *
 * 设计原则：
 *  - 生成器不认识业务，只认识 data/*.json 里的原型与行业行，所以加行业 = 加一行数据。
 *  - 产物是纯静态文件（无构建、无外链 CDN、无运行时依赖），任何环境都能打开。
 *  - 本文件只做本地文件生成：不联网、不执行外部命令。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, cpSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = resolve(HERE, '..')
const DATA = join(PLUGIN_ROOT, 'data', 'verticals.json')
const INDUSTRY_DATA = join(PLUGIN_ROOT, 'data', 'industries.json')
const ARCHETYPE_DATA = join(PLUGIN_ROOT, 'data', 'archetypes.json')
const CSS = () => readFileSync(join(PLUGIN_ROOT, 'templates', 'app.css'), 'utf8')

/* ---------------------------------------------------------------- verticals */

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

/**
 * 千行百业的核心：行业不手写模块，而是引用原型组合。
 * 行的结构见 data/industries.json 的 columns；tweaks 只改名/改描述。
 */
export function composeIndustry(row, archetypes) {
  const [id, label, kind, subtitle, accent, persona, pain, kpis, archetypeList, tweaks] = row
  const names = String(archetypeList ?? '').split(/[,\s]+/).filter(Boolean)
  const modules = []
  for (const key of names) {
    const base = archetypes[key]
    if (!base) continue
    const tweak = tweaks?.[key]
    modules.push({
      id: modules.some(m => m.id === key) ? `${key}-${modules.length}` : key,
      name: tweak?.[0] ?? base.name,
      desc: tweak?.[1] ?? base.desc,
      fields: base.fields,
      actions: base.actions,
    })
  }
  if (modules.length === 0) return null
  return {
    id, label, kind, subtitle, accent, persona, pain,
    kpis: String(kpis ?? '').split(/[,，]/).filter(Boolean).slice(0, 4),
    modules,
    source: 'industry',
  }
}

/**
 * 全量业态 = 精选 20 个（手调过模块）+ 行业字典组合结果。
 * id 或 label 与精选重复的行业行会被跳过——精选那份更具体。
 */
export function loadVerticals() {
  const curated = readJson(DATA).verticals
  const archetypes = readJson(ARCHETYPE_DATA).archetypes
  const ids = new Set(curated.map(v => v.id))
  const labels = new Set(curated.map(v => v.label))
  const composed = []
  for (const row of readJson(INDUSTRY_DATA).rows) {
    const v = composeIndustry(row, archetypes)
    if (!v || ids.has(v.id) || labels.has(v.label)) continue
    ids.add(v.id); labels.add(v.label)
    composed.push(v)
  }
  return [...curated, ...composed]
}

/** 只要组合行业（不含精选），用于统计与展示分层。 */
export function loadIndustries() {
  const archetypes = readJson(ARCHETYPE_DATA).archetypes
  return readJson(INDUSTRY_DATA).rows.map(row => composeIndustry(row, archetypes)).filter(Boolean)
}

export function findVertical(query) {
  if (!query) return null
  const q = String(query).trim().toLowerCase()
  const all = loadVerticals()
  return all.find(v => v.id === q)
    || all.find(v => v.label.toLowerCase() === q)
    || all.find(v => v.label.includes(q) || q.includes(v.label))
    || all.find(v => v.subtitle.toLowerCase().includes(q))
    || null
}

/** 自定义业态：只给模块名也能生成，字段按通用四件套兜底。 */
export function customVertical({ label, kind = 'store', modules = [], accent, persona, pain, kpis }) {
  const list = (Array.isArray(modules) ? modules : String(modules ?? '').split(/[,，、\s]+/))
    .filter(Boolean)
    .map((m, i) => typeof m === 'string'
      ? { id: `m${i + 1}`, name: m, desc: `${m}的日常处理`, fields: ['名称', '类型', '负责人', '状态'], actions: ['新增', '编辑'] }
      : { id: m.id ?? `m${i + 1}`, name: m.name, desc: m.desc ?? '', fields: m.fields ?? ['名称', '类型', '负责人', '状态'], actions: m.actions ?? ['新增'] })
  if (list.length === 0) list.push(
    { id: 'm1', name: '业务台账', desc: '主数据与日常单据', fields: ['单号', '客户', '金额', '状态'], actions: ['新增', '编辑'] },
    { id: 'm2', name: '客户管理', desc: '客户与联系人', fields: ['客户', '联系人', '电话', '等级'], actions: ['新增', '跟进'] },
    { id: 'm3', name: '统计报表', desc: '经营数据汇总', fields: ['日期', '营业额', '订单数', '客单价'], actions: ['导出'] },
  )
  return {
    id: slugify(label) || `custom-${Date.now().toString(36)}`,
    kind, label: label || '自定义业态', subtitle: '按需生成',
    accent: accent || '#2B6CB0', persona: persona || '负责人',
    pain: pain || '流程散在表格和微信里，数据对不上',
    kpis: kpis ?? ['今日单量', '本月金额', '待处理', '客户数'],
    modules: list,
  }
}

/* -------------------------------------------------------------------- utils */

export function slugify(input) {
  const ascii = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return ascii
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const hash = s => parseInt(createHash('sha1').update(String(s)).digest('hex').slice(0, 8), 16)
const pad = n => String(n).padStart(2, '0')

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function stamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 字段 → 像样的假数据。顺序很关键：先精确语义，再兜底，最后才是通用值。
 * 这里不做「智能」，只保证列表读起来不像占位符。
 */
function valueFor(field, i, v) {
  const f = String(field)
  const seed = hash(v.id + f + i)
  const pick = arr => arr[seed % arr.length]
  const money = () => '¥' + ((seed % 9000) + 200).toLocaleString()

  if (/状态/.test(f)) return pick(['进行中', '已完成', '待处理', '已取消'])
  // 标识类：不能落到通用值
  if (/桌号|台号|房号|笼位/.test(f)) return pick(['A', 'B', 'C', 'D']) + pad((seed % 18) + 1)
  if (/车牌/.test(f)) return pick(['京A', '沪B', '浙C', '粤B']) + String(10000 + (seed % 89999)).slice(0, 5)
  if (/手机|电话|联系方式/.test(f)) return '13' + String(100000000 + (seed % 89999999))
  if (/区域|位置|楼层|产线|科室|门店/.test(f)) return pick(['大厅', '包间', '露台', '吧台', '一号线', 'A 区'])
  if (/人数|就餐人数|桌数/.test(f)) return String((seed % 7) + 2)
  // 金额类
  if (/金额|售价|报价|费用|余额|应发|实发|合同额|GMV|工资|提成|毛利|营业额|单价|合计|进价|合同额|信用额度|工资总额|社保额/.test(f)) return money()
  // 日期类
  if (/日期|时间|到期|期间|时段|入住|离店|开始|结束|申报期|起止|复诊日|下次/.test(f)) {
    const d = new Date(Date.now() + (seed % 40 - 10) * 864e5)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  // 比例类
  if (/率|占比|完成度|装载率/.test(f)) return `${((seed % 40) + 55) / 10}%`.replace('.0%', '%')
  if (/数量|次数|库存|课时|名额|面积|年龄|里程|总次数|总课时|剩余|已耗|工龄|人数/.test(f)) return String((seed % 60) + 1)
  // 主体类
  if (/客户|会员|患者|学员|员工|司机|技师|老师|主播|委托人|供应商|分包商|分包商|宝宝|宠物|宠物名|检验员|药师|承办人|负责人|跟进人|会计|教练|教练/.test(f)) {
    return pick(['张伟', '李娜', '王强', '刘洋', '陈静', '赵磊', '周敏', '吴涛'])
  }
  if (/项目|订单号|单号|工单|运单|案号|合同号|批次|SKU|条码|处方号|发票号|卡号|采购单|运单号|合同号/.test(f)) {
    return pick(['A', 'B', 'C']) + (100000 + (seed % 899999))
  }
  if (/类型|类别|分类|等级|卡类型|方式|税种|险种|岗位|证照类型/.test(f)) return pick(['标准', 'A 类', 'B 类', '普通', 'VIP'])
  if (/名称|品名|商品|菜品|药品|物料|配件|课程|房源|小区|疾病|病种|隐患|活动|文书|项目名|产品|原料|配件名/.test(f)) {
    return pick(['西冷牛排', '双人套餐', '护理疗程', '年度会员卡', 'A 型配件', '春季班', '阳光小区 2 室', '标准款'])
  }
  return pick(['示例', '默认', '常规', '待定'])
}

/** KPI → 也按语义给值：金额带 ¥、比率一位小数或百分比、计数给合理区间。 */
function kpiValue(name, v, i) {
  const n = String(name)
  const seed = hash(v.id + n + i)
  if (/额|金|余额|GMV|收入|营业额/.test(n)) return '¥' + (8000 + (seed % 50000)).toLocaleString()
  if (/率|占比|达成/.test(n)) {
    if (/续费|复购|完成|准时|齐套|不良|退款|转化|到店率|齐套率/.test(n)) return `${60 + (seed % 38)}%`
    return `${(12 + (seed % 26)) / 10}`
  }
  if (/翻台/.test(n)) return `${(12 + (seed % 24)) / 10}`
  if (/工时/.test(n)) return `${180 + (seed % 220)}h`
  return String(8 + (seed % 112))
}

function statusClass(text) {
  if (/完成|已结|正常|已发|已付|签收|归档|通过|ok/i.test(text)) return 'ok'
  if (/待|进行|处理中|催|预警|申请/i.test(text)) return 'warn'
  if (/取消|逾期|异常|失败|退/.test(text)) return 'bad'
  return ''
}

/* --------------------------------------------------------------------- PRD */

function prdSections({ project, v, features, audience, nonGoals, period }) {
  const modules = v.modules
  const now = today()
  const featureList = (Array.isArray(features) && features.length ? features : modules.map(m => m.name))
  const goals = [
    `把「${featureList.slice(0, 3).join('、')}」从表格/微信搬进系统，1 名 ${v.persona} 可在 3 分钟内完成一单`,
    `关键单据当日可查，月底对账从半天压到 1 小时内`,
    `沉淀 ${v.kpis[0]} 等 ${v.kpis.length} 项指标，日/周报表自动出`
  ]
  const ng = Array.isArray(nonGoals) && nonGoals.length ? nonGoals
    : ['不做多组织/多法人复杂权限（本期仅单主体）', '不做财务总账，只做到开单与对账', '不接入第三方支付，仅记录支付方式']

  const funRows = modules.map((m, i) => ({
    id: `FR-${pad(i + 1)}`,
    name: m.name,
    desc: m.desc,
    fields: m.fields,
    actions: m.actions,
    p: i < 2 ? 'P0' : i < 4 ? 'P1' : 'P2',
  }))

  return [
    {
      h: '1. 背景与目标',
      md: [
        `**项目**：${project}　**业态**：${v.label}（${v.subtitle}）　**日期**：${now}　**周期**：${period ?? '2 周 MVP'}`,
        '',
        `**现状痛点**：${v.pain}。`,
        '',
        '**本期目标**',
        ...goals.map(g => `- ${g}`),
        '',
        '**非目标（本期不做）**',
        ...ng.map(g => `- ${g}`),
      ].join('\n'),
      html: `<p><b>项目</b>：${esc(project)}　<b>业态</b>：${esc(v.label)}（${esc(v.subtitle)}）　<b>日期</b>：${now}　<b>周期</b>：${esc(period ?? '2 周 MVP')}</p>
        <p><b>现状痛点</b>：${esc(v.pain)}。</p>
        <div class="cols"><div><h4>本期目标</h4><ul>${goals.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>
        <div><h4>非目标（本期不做）</h4><ul>${ng.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div></div>`,
    },
    {
      h: '2. 用户与场景',
      md: [
        `| 角色 | 关注点 | 高频动作 |`,
        `| --- | --- | --- |`,
        `| ${v.persona} | ${v.kpis.join('、')} | ${modules.slice(0, 3).map(m => m.actions[0]).join('、')} |`,
        `| 一线员工 | 少填字段、快速开单 | ${modules[0].actions.join('、')} |`,
        `| 老板/负责人 | 看数、看异常 | 日结、报表导出 |`,
        '',
        `**核心场景**：${audience ?? `${esc(v.persona)}早上开门，先看首页 ${v.kpis[0]}；白天在${modules[0].name}里开单；晚上做一次${modules.at(-1).name}。`}`,
        '',
        '**异常场景**：网络断/重复提交/权限不足/数据为空 四类，见第 4 节。',
      ].join('\n'),
      html: `<table><thead><tr><th>角色</th><th>关注点</th><th>高频动作</th></tr></thead><tbody>
        <tr><td>${esc(v.persona)}</td><td>${esc(v.kpis.join('、'))}</td><td>${esc(modules.slice(0, 3).map(m => m.actions[0]).join('、'))}</td></tr>
        <tr><td>一线员工</td><td>少填字段、快速开单</td><td>${esc(modules[0].actions.join('、'))}</td></tr>
        <tr><td>老板 / 负责人</td><td>看数、看异常</td><td>日结、报表导出</td></tr></tbody></table>
        <p><b>核心场景</b>：${esc(audience ?? `${v.persona}早上开门，先看首页${v.kpis[0]}；白天在${modules[0].name}开单；晚上做一次${modules.at(-1).name}。`)}</p>`,
    },
    {
      h: '3. 功能清单',
      md: [
        '| 编号 | 模块 | 说明 | 优先级 | 主流程 | 异常/边界 |',
        '| --- | --- | --- | --- | --- | --- |',
        ...funRows.map(r => `| ${r.id} | ${r.name} | ${r.desc} | ${r.p} | ${r.actions.join(' → ')} | 空列表、超限、重复提交、无权限 |`),
      ].join('\n'),
      html: `<table><thead><tr><th>编号</th><th>模块</th><th>说明</th><th>优先级</th><th>主流程</th><th>异常 / 边界</th></tr></thead><tbody>
        ${funRows.map(r => `<tr><td>${r.id}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.desc)}</td><td>${r.p}</td><td>${esc(r.actions.join(' → '))}</td><td>空列表、超限、重复提交、无权限</td></tr>`).join('')}
        </tbody></table>`,
    },
    {
      h: '4. 交互与规则',
      md: [
        ...modules.flatMap((m, i) => [
          `### 4.${i + 1} ${m.name}`,
          `- 字段：${m.fields.map(f => `\`${f}\``).join('、')}`,
          `- 字段规则：文本 ≤ 50 字；金额保留 2 位；日期不得早于今天；必填项为前两项`,
          `- 操作：${m.actions.join(' / ')}`,
          `- 列表默认按时间倒序，支持关键字搜索与状态筛选`,
          '',
        ]),
        '**权限**：店长/负责人可改价与删单；员工只能开单与查询；报表仅负责人可见。',
        '',
        '**异常处理**：空数据展示引导而非空白页；提交中禁用按钮防重复；接口失败保留草稿并提示重试；越权请求前端隐藏 + 后端拒绝。',
      ].join('\n'),
      html: `${modules.map((m, i) => `<h4>4.${i + 1} ${esc(m.name)}</h4>
        <ul><li>字段：${m.fields.map(f => `<code>${esc(f)}</code>`).join('、')}</li>
        <li>字段规则：文本 ≤ 50 字；金额 2 位小数；日期不得早于今天；前两项必填</li>
        <li>操作：${esc(m.actions.join(' / '))}</li>
        <li>列表默认时间倒序，支持搜索与状态筛选</li></ul>`).join('')}
        <p><b>权限</b>：${esc(v.persona)}可改价与删单；员工只能开单与查询；报表仅负责人可见。</p>
        <p><b>异常处理</b>：空数据展示引导；提交中禁用按钮；失败保留草稿可重试；越权前端隐藏 + 后端拒绝。</p>`,
    },
    {
      h: '5. 验收标准',
      md: [
        '| 编号 | 验收项 | 通过条件 |',
        '| --- | --- | --- |',
        ...funRows.map(r => `| AC-${r.id.slice(3)} | ${r.name} | 能完成「${r.actions[0]}」并落库，列表立即可见；刷新不丢 |`),
        `| AC-06 | 权限 | 员工账号看不到改价/删单入口，直接调接口返回 403 |`,
        `| AC-07 | 性能 | 列表首屏 ≤ 1.5s（1000 条数据），搜索 ≤ 500ms |`,
      ].join('\n'),
      html: `<table><thead><tr><th>编号</th><th>验收项</th><th>通过条件</th></tr></thead><tbody>
        ${funRows.map(r => `<tr><td>AC-${r.id.slice(3)}</td><td>${esc(r.name)}</td><td>能完成「${esc(r.actions[0])}」并落库，列表立即可见；刷新不丢</td></tr>`).join('')}
        <tr><td>AC-06</td><td>权限</td><td>员工账号看不到改价/删单入口，直接调接口返回 403</td></tr>
        <tr><td>AC-07</td><td>性能</td><td>列表首屏 ≤ 1.5s（1000 条），搜索 ≤ 500ms</td></tr>
        </tbody></table>`,
    },
    {
      h: '6. 上线与埋点',
      md: [
        `- 灰度：先给 1 家门店用 3 天，再全量`,
        `- 埋点：${modules.map(m => m.name).join('、')} 各记「进入 / 操作成功 / 失败」三类事件`,
        `- 监控：接口成功率 < 99% 告警；日单量环比跌幅 > 30% 告警`,
        `- 回滚：静态资源保留上一版，接口双写 24h，异常一键切回`,
        '',
        '**数据字典**：主键 `id`；审计字段 `created_at` / `updated_at` / `operator`；金额一律以「分」存储。',
      ].join('\n'),
      html: `<ul><li>灰度：先给 1 家门店用 3 天，再全量</li>
        <li>埋点：${modules.map(m => esc(m.name)).join('、')} 各记「进入 / 操作成功 / 失败」</li>
        <li>监控：接口成功率 &lt; 99% 告警；日单量环比跌幅 &gt; 30% 告警</li>
        <li>回滚：静态资源保留上一版，接口双写 24h，异常一键切回</li></ul>
        <p><b>数据字典</b>：主键 <code>id</code>；审计字段 <code>created_at</code> / <code>updated_at</code> / <code>operator</code>；金额以「分」存储。</p>`,
    },
  ]
}

export function renderPRD(opts) {
  const v = opts.vertical
  const sections = prdSections({ ...opts, v })
  const md = [
    `# ${opts.project} · 产品需求文档（PRD）`,
    '',
    `> 业态：${v.label}（${v.subtitle}）　生成：${today()}　模板：dsh-forge/prd-v1`,
    '',
    ...sections.flatMap(s => [`## ${s.h}`, '', s.md, '']),
    '---',
    `本文档由 dsh-forge 按行业模板生成，业务规则需人工确认后定稿。`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.project)} · PRD</title>
<style>
  :root { --accent: ${v.accent}; --ink: #14181f; --ink-2: #5b6472; --line: #e6e9ee; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f7f9; color: var(--ink);
    font: 15px/1.75 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 40px 22px 80px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 34px 40px;
    box-shadow: 0 1px 2px rgba(16,24,40,.06), 0 8px 24px rgba(16,24,40,.05); }
  .kicker { color: var(--accent); font-size: 12.5px; letter-spacing: .08em; text-transform: uppercase; font-weight: 700; }
  h1 { font-size: 27px; margin: 8px 0 6px; letter-spacing: -.02em; }
  .meta { color: var(--ink-2); font-size: 13px; border-bottom: 1px solid var(--line); padding-bottom: 18px; }
  h2 { font-size: 18px; margin: 34px 0 12px; padding-top: 18px; border-top: 1px solid var(--line); }
  h2:first-of-type { border-top: 0; }
  h4 { font-size: 14.5px; margin: 20px 0 6px; }
  p { margin: 8px 0; color: #232a33; }
  ul { margin: 8px 0; padding-left: 20px; }
  li { margin: 4px 0; }
  code { background: #f1f4f8; border-radius: 5px; padding: 1px 6px; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13.5px; }
  th, td { border: 1px solid var(--line); padding: 8px 11px; text-align: left; vertical-align: top; }
  th { background: #fafbfc; color: var(--ink-2); font-weight: 600; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 720px) { .card { padding: 24px 18px; } .cols { grid-template-columns: 1fr; } }
  .toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; }
  .toc a { font-size: 12.5px; color: var(--ink-2); border: 1px solid var(--line); border-radius: 999px; padding: 4px 11px; text-decoration: none; }
</style></head>
<body><div class="wrap"><div class="card">
  <div class="kicker">Product Requirement Document</div>
  <h1>${esc(opts.project)}</h1>
  <div class="meta">业态：${esc(v.label)}（${esc(v.subtitle)}） · 生成日期：${today()} · 模板 prd-v1</div>
  <div class="toc">${sections.map((s, i) => `<a href="#s${i}">${esc(s.h)}</a>`).join('')}</div>
  ${sections.map((s, i) => `<section id="s${i}"><h2>${esc(s.h)}</h2>${s.html}</section>`).join('\n')}
  <p style="margin-top:30px;color:#8b94a3;font-size:12.5px">本文档由 dsh-forge 按行业模板生成，业务规则需人工确认后定稿。</p>
</div></div></body></html>`

  return { md, html, sectionCount: sections.length }
}

/* -------------------------------------------------------------------- demo */

function consoleHtml({ project, v, tagline }) {
  const nav = v.modules.map((m, i) => `<div class="nav-item${i === 0 ? ' on' : ''}" data-view="${m.id}"><span class="nav-dot"></span>${esc(m.name)}</div>`).join('')
  const views = v.modules.map((m, i) => {
    const rows = Array.from({ length: 7 }, (_, r) => {
      const cells = m.fields.map(f => {
        const val = valueFor(f, r, v)
        return /状态/.test(f) ? `<td><span class="status ${statusClass(val)}">${esc(val)}</span></td>` : `<td>${esc(val)}</td>`
      }).join('')
      return `<tr data-row>${cells}<td class="row-actions">${esc(m.actions[0])}</td></tr>`
    }).join('')
    const kp = v.kpis.map((k, ki) => {
      const val = kpiValue(k, v, ki)
      return `<div class="kpi"><div class="kpi-label">${esc(k)}</div><div class="kpi-value">${val}</div><div class="kpi-delta${ki === 2 ? ' down' : ''}">${ki === 2 ? '↓' : '↑'} ${(hash(k) % 9) + 1}.${hash(k) % 9}% 环比</div></div>`
    }).join('')
    return `<section class="view" data-view="${m.id}" ${i === 0 ? '' : 'hidden'}>
      <div class="page-head"><div><h2>${esc(m.name)}</h2><p>${esc(m.desc)}</p></div>
        <div style="margin-left:auto;display:flex;gap:8px"><button class="btn">导出</button><button class="btn primary" data-add>+ ${esc(m.actions[0])}</button></div></div>
      <div class="kpis">${kp}</div>
      <div class="card">
        <div class="card-head"><h3>${esc(m.name)}列表</h3><span class="chip">共 7 条 · 演示数据</span>
          <div class="spacer"></div><span class="chip">今日</span></div>
        <div class="tabs"><span class="tab on">全部</span><span class="tab">进行中</span><span class="tab">已完成</span></div>
        <table><thead><tr>${m.fields.map(f => `<th>${esc(f)}</th>`).join('')}<th>操作</th></tr></thead>
        <tbody data-body>${rows}</tbody></table>
        <div class="empty" data-empty hidden>没有匹配记录，换个关键字试试</div>
      </div>
      <p style="color:#8b94a3;font-size:12.5px;margin-top:12px">演示用静态数据 · 接后端时把 data-body 换成接口返回即可</p>
    </section>`
  }).join('')

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(project)} · 工作台</title>
<style>${CSS()}</style><style>:root{--accent:${v.accent}}</style></head>
<body><div class="shell">
  <aside class="side">
    <div class="brand"><div class="brand-mark">${esc(project.slice(0, 1))}</div>
      <div><div class="brand-name">${esc(project)}</div><div class="brand-sub">${esc(v.label)}工作台</div></div></div>
    <div class="nav-label">业务</div>
    ${nav}
    <div class="side-foot">${esc(tagline)}<br>dsh-forge 生成 · 演示版</div>
  </aside>
  <main class="main">
    <div class="topbar"><h1 data-title>${esc(v.modules[0].name)}</h1><span class="crumb">${esc(project)} / ${esc(v.label)}</span>
      <div class="topbar-right"><div class="search">⌕<input placeholder="搜索单号 / 客户 / 电话" data-search></div>
        <button class="btn">${esc(v.persona)}</button><button class="btn primary">日结</button></div></div>
    <div class="page">${views}</div>
  </main>
</div>
<script>
  const navs = [...document.querySelectorAll('.nav-item')]
  const views = [...document.querySelectorAll('.view')]
  const title = document.querySelector('[data-title]')
  navs.forEach(n => n.addEventListener('click', () => {
    navs.forEach(x => x.classList.toggle('on', x === n))
    views.forEach(x => x.hidden = x.dataset.view !== n.dataset.view)
    title.textContent = n.textContent.trim()
  }))
  const search = document.querySelector('[data-search]')
  search.addEventListener('input', () => {
    const q = search.value.trim()
    const view = views.find(x => !x.hidden); if (!view) return
    const rows = [...view.querySelectorAll('tr[data-row]')]
    let shown = 0
    rows.forEach(r => { const hit = !q || r.textContent.includes(q); r.hidden = !hit; if (hit) shown++ })
    view.querySelector('[data-empty]').hidden = shown > 0
  })
  document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    const view = b.closest('.view'); const body = view.querySelector('[data-body]')
    const first = body.querySelector('tr[data-row]'); if (!first) return
    const clone = first.cloneNode(true)
    clone.querySelectorAll('td').forEach((td, i) => { if (i === 0) td.textContent = '新建-${pad(new Date().getMinutes())}' })
    body.prepend(clone)
  }))
</script></body></html>`
}

function h5Html({ project, v, tagline }) {
  const tiles = v.modules.map((m, i) =>
    `<div class="tile" data-tile="${m.id}"><div class="ico">${esc(m.name.slice(0, 1))}</div><b>${esc(m.name)}</b><span>${esc(m.desc)}</span></div>`).join('')
  const feed = v.modules.slice(0, 4).map((m, i) => {
    const s = valueFor('状态', i, v)
    return `<div class="li"><span>${esc(m.actions[0])} · ${esc(valueFor(m.fields[0], i, v))}</span><span class="m">${esc(s)}</span></div>`
  }).join('')
  const forms = v.modules.map(m => `<div class="sheet" data-sheet="${m.id}"><div class="sheet-body">
      <h3>${esc(m.name)}</h3><p>${esc(m.desc)}</p>
      ${m.fields.map((f, i) => `<div class="field"><label>${esc(f)}${i < 2 ? ' *' : ''}</label>
        ${/状态|类型|类别|方式/.test(f)
          ? `<select><option>标准</option><option>A 类</option><option>VIP</option></select>`
          : `<input placeholder="请输入${esc(f)}" value="${esc(valueFor(f, 0, v))}">`}</div>`).join('')}
      <button class="btn primary" style="width:100%;margin-top:8px" data-close>提交 ${esc(m.actions[0])}</button>
    </div></div>`).join('')

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${esc(project)} · 移动端</title><style>${CSS()}</style><style>:root{--accent:${v.accent}}</style></head>
<body class="h5"><div class="phone">
  <div class="hd"><div class="hd-top"><div><h1>${esc(project)}</h1><p>${esc(tagline)}</p></div><div class="avatar">我</div></div></div>
  <div class="hero">
    ${v.kpis.slice(0, 3).map((k, i) => `<div><b>${kpiValue(k, v, i)}</b><span>${esc(k)}</span></div>`).join('')}
  </div>
  <div class="sec"><div class="sec-head"><h2>常用功能</h2><a>全部 ›</a></div><div class="grid2">${tiles}</div></div>
  <div class="sec"><div class="sec-head"><h2>最近动态</h2><a>更多 ›</a></div><div class="list">${feed}</div></div>
  <div class="sec" style="padding-bottom:24px"><div class="sec-head"><h2>快速开单</h2></div>
    <button class="btn primary" style="width:100%;padding:13px" data-open="${v.modules[0].id}">+ ${esc(v.modules[0].actions[0])}${esc(v.modules[0].name)}</button></div>
  <div class="tabbar"><div class="on"><i>⌂</i>首页</div><div><i>▤</i>单据</div><div><i>◉</i>客户</div><div><i>☺</i>我的</div></div>
  ${forms}
</div>
<script>
  const open = id => document.querySelector('[data-sheet="' + id + '"]')?.classList.add('on')
  document.querySelectorAll('[data-tile]').forEach(t => t.addEventListener('click', () => open(t.dataset.tile)))
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => open(b.dataset.open)))
  document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s || e.target.hasAttribute('data-close')) s.classList.remove('on') }))
  document.querySelectorAll('.tabbar div').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tabbar div').forEach(x => x.classList.toggle('on', x === t))
  }))
</script></body></html>`
}

export function renderDemo({ project, vertical: v, tagline }) {
  return {
    console: consoleHtml({ project, v, tagline }),
    h5: h5Html({ project, v, tagline }),
  }
}

/* ---------------------------------------------------------------- filesystem */

function ensureDir(dir) { mkdirSync(dir, { recursive: true }) }

export function writeProject({ dir, files }) {
  ensureDir(dir)
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel)
    ensureDir(dirname(target))
    writeFileSync(target, content)
  }
  return dir
}

export function projectManifest({ project, v, site, dir }) {
  return JSON.stringify({
    project, site, vertical: v.id, verticalLabel: v.label,
    kind: v.kind, generatedAt: new Date().toISOString(),
    files: existsSync(dir) ? readdirSync(dir) : [],
  }, null, 2)
}

export { today, stamp, esc }
