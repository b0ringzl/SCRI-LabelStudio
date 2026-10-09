# 千问与 DeepSeek 视觉 LLM 接入

Atlas Studio 可通过本机代理调用千问视觉或 DeepSeek 视觉模型。浏览器仅向同源 `/api/llm/predict` 提交当前图片；代理从启动进程的环境变量读取对应提供方的 API Key，再调用 OpenAI 兼容视觉接口。真实数据不会随软件包上传到 GitHub。运行预测会将当前图片发送给所配置的模型服务，请先确认团队的数据使用要求。

## 千问 · Windows（PowerShell）

在解压目录打开 PowerShell，按所在地域和工作空间填写实际服务根地址；以下 `WorkspaceId` 是占位符：

```powershell
$env:DASHSCOPE_API_KEY = Read-Host '请输入百炼 API Key'
$env:ATLAS_LLM_BASE_URL = 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
$env:ATLAS_LLM_MODELS = 'qwen3-vl-plus'
.\Start-Atlas-Windows.bat
```

在源码目录也可先执行 `npm ci`、`npm run build`，然后运行同一启动脚本。环境变量仅属于当前 PowerShell 会话；不要把 API Key 写进 `.bat`、仓库或截图。

## 千问 · macOS（Terminal）

在解压目录运行：

```sh
read -s DASHSCOPE_API_KEY; export DASHSCOPE_API_KEY
export ATLAS_LLM_BASE_URL='https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
export ATLAS_LLM_MODELS='qwen3-vl-plus'
sh ./Start-Atlas-macOS.command
```

如使用其他地域，请将服务根地址换成该地域的 `/compatible-mode/v1` 地址，同时使用同地域的 API Key。支持以逗号分隔多个已获准模型名，例如 `ATLAS_LLM_MODELS='qwen3-vl-plus,qwen-vl-max'`，每个模型可在 UI 中单独建立配置并切换。`ATLAS_LLM_BASE_URL` 和 Key 只由启动进程控制，浏览器不能指定上游域名。

## DeepSeek · Windows 与 macOS

DeepSeek 官方视觉接口当前支持 `deepseek-flash` 的图像输入，服务根地址为 `https://api.deepseek.com`。千问和 DeepSeek 使用**各自的 Key、模型允许列表和上游地址**，在 UI 中可随时切换，互不共用密钥。

Windows PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = Read-Host '请输入 DeepSeek API Key'
$env:ATLAS_DEEPSEEK_MODELS = 'deepseek-flash'
.\Start-Atlas-Windows.bat
```

macOS Terminal：

```sh
read -s DEEPSEEK_API_KEY; export DEEPSEEK_API_KEY
export ATLAS_DEEPSEEK_MODELS='deepseek-flash'
sh ./Start-Atlas-macOS.command
```

DeepSeek 默认使用官方 `https://api.deepseek.com`；需要企业网关时，启动前设置 `ATLAS_DEEPSEEK_BASE_URL` 为受信任的 HTTPS 服务根地址。无需同时配置千问；若要在同一工作台切换两家模型，请在**同一个**终端会话中设置两组环境变量，再启动一次服务。

## 界面流程

1. 打开“预标注接口”→“新增模型服务”，适配方式选“千问视觉 · 本机代理”或“DeepSeek 视觉 · 本机代理”，填写对应允许列表中的模型名。可以分别为普通图片与点云／全景任务创建配置。
2. 在道路设施复核页选择该模型，点击“运行当前图片”：浏览器按原图比例缩至最长边 1600 像素，发送当前图片，返回 2D 框候选。已有 YOLO 框不被覆盖。
3. 在点云／全景工作台选择该模型，点击“运行当前配对任务”：只发送当前全景影像，返回全景 2D 区域候选。不会发送点云，也不会由 LLM 生成有度量意义的 3D 框或逐点标签。
4. 在紫色候选层逐项接受或忽略；接受后仍应人工修正并保存／导出。模型可能漏标、错标或返回不准确的位置；目前没有在真实千问服务上验证本批次的定位精度。

## 接口与约束

- 同源接口：`POST /api/llm/predict`，JSON `{ "provider": "qwen" | "deepseek", "modelName", "imageDataUrl", "classes": [{"id","name"}], "kind": "image2d" | "panorama" }`。仅接受本机 `127.0.0.1` 同源请求。图片经浏览器缩放为 JPEG Data URL；请求上限 10 MB，超时 120 秒。
- 上游接口：`POST {提供方 BASE_URL}/chat/completions`，`Authorization: Bearer` 使用该提供方的服务端环境变量。请求采用视觉消息 `image_url.url` 的 base64 Data URL。上游输出必须为 JSON `{ "boxes": [{"classId","x","y","w","h"}] }`，坐标均为 `[0,1]` 归一化中心宽高。
- 网关按本次类别表和边界验证最多 100 个候选；不合规输出会显示错误，不进入标注。LLM 不提供可校准的置信度；UI 不显示伪造的分数。
- API Key、上游域名与模型允许列表都不放入浏览器配置或导出文件。启动时若缺少配置，运行按钮会报出缺失的环境变量。仓库不包含真实 Key。

百炼官方视觉接口、地域端点与环境变量用法：[通过 OpenAI 接口调用千问 VL](https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai)。base64 Data URL 示例见[百炼批处理接口文档](https://help.aliyun.com/zh/model-studio/batch-interfaces-compatible-with-openai)。

DeepSeek 的图像输入、`deepseek-flash`、官方服务地址与 base64 用法见其[视觉接口文档](https://api-docs.deepseek.com/guides/vision/)。
