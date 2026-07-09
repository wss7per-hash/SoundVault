# SoundVault

本地 AI 音效库管理工具。把散落在各处的音效文件集中管理，并通过大模型自动生成**使用场景、形象描述、关联关键词和拟声词**，让每个音效都变得「可搜索、可发现」。

> 纯本地桌面软件（Electron），音效文件与数据库都在你自己的机器上，AI 分析需要的 API Key 也仅保存在本地用户目录，不会上传到任何第三方服务器（除你配置的 AI 服务商外）。

---

## 功能特性

- **音效库管理**：导入本地音频目录，自动扫描文件、读取时长等元数据，建立本地 SQLite 索引。
- **AI 语义分析**（核心）：调用大模型把音效「翻译成人话」——
  - 形象描述（日常语言 + 比喻）
  - 使用场景（游戏 / 视频 / UI 等什么时候用）
  - 关联关键词
  - 拟声词（如「金币 → 叮当」「扫射 → 哒哒哒」「水流 → 哗啦啦」）
  - 自动打 3–6 个语义标签，覆盖多个分类维度
- **标签筛选**：左侧标签树，点击即可在右侧过滤出对应音效。
- **音频播放**：内置播放器 + 波形显示，悬停试听；通过私有协议 (`sv://`) 安全加载本地文件，跨 dev / 打包环境一致可用，支持进度拖动。
- **分析可控**：支持单条 / 批量分析，可并发；分析过程中可随时「取消」，互不阻塞。
- **AI 服务商可配置**：内置 OpenAI、DeepSeek、Anthropic、Gemini、Ollama、TokenDance 等预设，也支持完全自定义的 OpenAI 兼容网关。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | Electron 33 + electron-vite |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 状态 | Zustand |
| 数据库 | better-sqlite3（本地 SQLite） |
| 音频 | wavesurfer.js（波形） + 私有 `sv://` 协议加载本地文件 |

---

## 目录结构

```
SoundVault/
├── src/
│   ├── main/                 # Electron 主进程（数据库、AI 分析、IPC、协议）
│   │   ├── database.ts       # SQLite 初始化、迁移、标签清理
│   │   ├── ai-analyzer.ts   # AI 语义分析引擎（并发 / 取消 / 兜底）
│   │   ├── ipc-handlers.ts  # 渲染进程 ↔ 主进程 通信
│   │   └── index.ts         # 应用入口、sv:// 协议注册
│   ├── preload/             # 安全桥接（contextIsolation）
│   └── renderer/            # React 渲染进程（UI）
│       ├── components/       # 详情面板、音效网格、标签树、快捷栏…
│       ├── stores/           # Zustand 状态管理
│       └── pages/           # 页面级组件
├── resources/               # 打包资源 / 图标
├── electron.vite.config.ts  # 构建配置
├── electron-builder.yml     # 安装包配置
└── package.json
```

---

## 安装与运行

要求 **Node.js 18+** 与 **ffmpeg / ffprobe**（用于读取音频元数据，需放在系统 `PATH` 或默认安装位置）。

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（热重载；修改主进程后需手动重启后台 dev 进程）
npm run dev

# 3. 打包（生成 Windows 安装包到 dist/）
npm run dist
```

> 开发环境运行前请确保没有遗留的 `ELECTRON_RUN_AS_NODE` 环境变量，否则 Electron 会退化成普通 Node。

---

## 配置 AI 分析

首次使用需在设置中填写 AI 服务商信息：

1. 打开 **模型配置**，选择服务商（如 TokenDance / DeepSeek / 自定义 OpenAI 兼容网关）。
2. 填入 **API Endpoint** 与 **API Key**（仅保存在本机 `userData`，不入源码、不上传）。
3. 选择模型（如 `deepseek-v3.2`）。
4. 点击「测试连接」确认可用。

> 注意：部分聚合网关的「查模型列表」免费，但「实际对话推理」可能因账户额度不足而返回 402。请先在对应控制台确认有可用额度。

分析时如有网络中断或模型超时，可随时点击「取消」；分析失败不会写入假数据，可重试。

---

## 数据说明

- 音效文件**不会被复制或移动**，数据库只保存文件路径与本机元数据索引。
- 本地数据文件（`.db`）、`node_modules/`、`dist/` 等已在 `.gitignore` 中排除，不进入版本库。
- 换机器或重装时注意备份数据库文件（通常位于用户数据目录下的 `soundvault.db`）。

---

## 仓库与备份

源码托管于 GitHub：https://github.com/wss7per-hash/SoundVault

日常提交流程：

```bash
git add -A
git commit -m "你的修改说明"
git push
```

---

## 未来开发计划（Roadmap）

以下功能已规划、暂未实施，纳入后续迭代：

### 1. 提示词生成音效（text-to-SFX）⭐ 优先级最高
- 根据提示词调用文本→音效生成模型，产出全新音效。
- 候选：**ElevenLabs SFX V2**（有 API、质量高、商业授权清晰、原生支持 48kHz 无缝循环）/ **Stable Audio 2.0**（API + 开源权重，可本地部署）。
- 架构：新增独立的「生成」模块，与现有 AI 分析链路解耦；配置项复用现有 AI 服务商配置 UX。

### 2. 首尾无缝循环（纯 DSP，无需 AI）⭐ 性价比最高、最该先做
- 通过 ffmpeg 交叉淡化（crossfade）/ 自动寻找最佳衔接点，实现本地音频无缝循环。
- 不依赖任何生成模型，纯音频处理，实现成本低、收益高。
- 注：若后续接入 ElevenLabs SFX，其 V2 已原生输出无缝循环音频。

### 3. 生成类似音频（audio-to-audio / 参考生成）
- 参考输入音效，生成风格 / 内容相近的新音效。
- 可行路线：将本库已生成的「使用场景 + 拟声词 + 标签」作为 prompt 喂给 text-to-SFX 模型，近似实现「类似」。
- 更彻底的 audio-to-audio 参考生成目前模型尚不成熟，暂缓。

### 4. 延长当前音频（extension）
- 真·AI 续写：Stable Audio inpainting（质量待评估）。
- 低成本替代：DSP 时间拉伸（变速不变调）或循环拼接，多数「延长」需求可由此满足，无需生成模型。

### 备注
- 生成类功能（1 / 3 / 4）需接入外部音频生成 API 或本地部署生成模型（Stable Audio / AudioCraft 开源权重），按次计费或需 GPU 算力。
- 音乐生成模型（Suno / Udio）偏音乐且 API 受限，与游戏 / UI 音效库场景不匹配，暂不纳入。

---

## License

MIT
