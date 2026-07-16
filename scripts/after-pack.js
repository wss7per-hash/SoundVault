// 删除打包产物中的多余 locale 文件，仅保留 zh-CN、zh-TW、en-US
const fs = require('fs')
const path = require('path')

exports.default = async function (context) {
  const localesDir = path.join(context.appOutDir, 'locales')
  if (!fs.existsSync(localesDir)) return

  const keep = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak'])
  const files = fs.readdirSync(localesDir)
  let removed = 0

  for (const file of files) {
    if (!keep.has(file) && file.endsWith('.pak')) {
      fs.unlinkSync(path.join(localesDir, file))
      removed++
    }
  }

  console.log(`[after-pack] 已移除 ${removed} 个多余 locale 文件，保留 zh-CN / zh-TW / en-US`)
}
