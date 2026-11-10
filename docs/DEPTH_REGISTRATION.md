# DA² 全景深度辅助配准（0.16.0）

本功能将公开 DA² 模型接入现有配准工作流。输入为一张 2:1 全景、实际 XYZ 点云和相机粗位姿；先预测相对尺度的径向深度，再求局部外参修正。无需上下双目图像，不要求点云带强度或颜色。

它是实验性局部精配准后端，不是无初值全局配准。单目深度有尺度不确定性与局部形状误差，内部残差下降不能证明真实旋转误差小于 4°。正式位姿仅在用户点击“应用当前候选”后改变。

## 安装与启动

两平台使用相同前端、API、官方权重及求解器，模型与数据都在本机处理。大权重不放入 Git 或发布 ZIP。

### Windows

1. 准备 Git、Python 3.10+、Node.js 20.19+；推荐 NVIDIA GPU，驱动需兼容 CUDA 12.4。
2. 双击 `Setup-Depth-Windows.bat`。脚本只建立本项目 `.venv-da2`，固定下载官方源码与约 1.38 GB 权重；首次安装 CUDA PyTorch 另需数 GB 下载空间。
3. 无 NVIDIA GPU 可在终端运行 `py -3 scripts/setup_depth.py --cpu`，CPU 推理速度需另测。
4. 运行原有 `Start-Atlas-Windows.bat`，或为本地场景集运行：

```powershell
node scripts/serve.mjs --scene-dir "本地场景集路径" --port 43987
```

本机验证使用了项目目录中的独立 Conda Python 3.12 环境，网关同时支持独立 Conda 和普通 venv，无需激活环境。

### macOS

1. 准备 Git、Python 3.10+、Node.js 20.19+。本地 DA² 安装脚本面向 Apple Silicon；模型 MPS 性能尚未实机验证。
2. 在项目目录执行 `sh ./Setup-Depth-macOS.command`。
3. 执行 `sh ./Start-Atlas-macOS.command`。
4. 网关自动选择 MPS，没有可用加速设备则选择 CPU。可设置 `ATLAS_DEPTH_DEVICE=cpu` 诊断 MPS 兼容问题。

Intel Mac 仍能使用原有标注界面和 NID 配准，本版不提供其 DA² 本地运行时。

安装失败可重新运行同一脚本；不会改动 TREE、其他 Conda 环境或系统 Python。下载完成前权重使用 `.partial` 文件名，大小和 SHA-256 均通过后才启用。

## 在界面中试用

1. 在“数据”导入点云、全景与逐帧粗位姿，或选择已有真实场景。
2. 进入“配准 → 粗配准”。方法下拉框选择“DA² · 全景深度辅助”。
3. 点击“自动精配准”，等待当前帧预测和几何求解；运行时可以取消。
4. 展开“查看 DA² 深度”。颜色仅表达相对远近：蓝色近、红色远；不是米制测量。
5. 有候选时，切换“投影叠加”，使用“查看原位姿／预览候选”对照静态建筑边缘、立柱和道路设施。修正的角度和距离不是误差真值。
6. 检查通过再点击“应用当前候选”；否则“舍弃候选”。不通过内部检查的结果只显示深度与拒绝原因，不允许应用。
7. “更多设置”中可批量处理全部帧。当前实现逐帧独立求解，并非多帧联合硬件外参标定。
8. 下拉切换“NID · 无需模型权重”可比较已有方法；两种方法的指标不能直接互比。

改变原位姿或导入另一组位姿后，需要重新计算候选。已应用的配准会记录 `auto-depth` 来源与算法版本，并将受影响的多帧定位结果标记为需要复核。

## 接口

`GET /api/registration/depth` 检查项目独立 Python、依赖、固定源码与权重，返回 `configured`、`device`、`reason` 等。即使权重未安装，界面也可以正常启动并使用 NID。

`POST /api/registration/depth` 只接受 `127.0.0.1` 上的同源请求；请求体最多 12 MiB，一次处理一帧，超时 300 秒。中断浏览器请求会终止该次 Python 子进程。

```json
{
  "schemaVersion": "registration-depth/1.0",
  "frameId": "frame-001",
  "prior": {"position": [0, 0, 0], "rotation": [0, 0, 0]},
  "points": [[1, 0, -5]],
  "imageDataUrl": "data:image/jpeg;base64,..."
}
```

上例省略了点数组其余内容；实际需要 1000–40000 个有限 XYZ 点。坐标必须与浏览器场景一致：相机 +X 向右、+Y 向上、-Z 向前，`prior` 为 camera-to-cloud，`rotation` 为 yaw/pitch/roll、角度制、YXZ 顺序。不能直接传未转换的厂商轴约定。

返回字段：

| 字段 | 含义 |
|---|---|
| `status` | `candidate` 或 `rejected`；拒绝时不会更新位姿 |
| `registration` | 求解出的 camera-to-cloud；只有候选可由用户确认应用 |
| `depthPreviewDataUrl` | JPEG 相对深度图，供界面查看 |
| `depthIsMetric` | 固定为 `false`，预测不自带米制尺度 |
| `inference` | 实际设备、纯前向耗时与 CUDA 峰值显存 |
| `cacheHit` | 是否复用同一图像与固定模型生成的深度 |
| `metrics` | 几何诊断，下表说明 |
| `sourceRevision/modelRevision` | 固定官方源码、权重版本 |
| `independentlyVerified` | 固定为 `false`，表示没有独立标定真值认证 |

几何指标包括训练/留出区域的绝对对数深度残差中位数、留出区域 P75、深度比例、有效点数、修正角度/距离、搜索边界状态与错误朝向对照的区分度。`scaleAfter` 是预测深度到当前点云单位的拟合比例；只有源点云单位已确认为米时才能解释为米制转换。

## 求解过程与采用条件

1. 浏览器空间采样最多 28000 个相机附近点，不使用伪彩或强度。
2. 官方模型按 1092×546 网格推理。使用原生 PyTorch SDPA 后备路径，不强制安装 xFormers；官方网络与权重保持原样。
3. 在粗位姿上作球面 Z-buffer，保留最近表面，过滤极区、过陡的深度断层与过远点。
4. 按完整角度小块分出留出区域。联合优化三维平移、旋转和一个正的深度比例。
5. 六个起点/鲁棒损失组合仅按训练区域分数择优，先排除达到局部边界的假设；不会按留出结果挑选模型。
6. 采用条件同时检查训练中位数改善、留出中位数改善、P75 不恶化、对照方向区分度及局部范围。最大旋转修正小于 6°、平移修正小于 0.85 个场景单位；这不是实际配准精度指标。
7. 浏览器重复验证关键指标和位姿修正范围，再允许用户确认。

模型深度以图像内容、模型校验值和算法版本组成缓存键，保存在忽略的 `local-samples/depth-cache`，只存相对深度与推理元数据，不把粗位姿缓存成当前配准。修改初值会重新求解几何；切换图像不会复用另一帧预测。

## 实测与限制

本机 RTX 4090 D / 24 GB、Windows 独立 Python 3.12、PyTorch 2.5.0+cu124，采用官方公开权重。首轮五张真实全景均完成深度预测，纯模型前向约 0.88–0.95 秒，峰值显存约 2.82 GiB；进程启动、读取模型、传输、几何求解另计。浏览器 JPEG 编码、采样与命令行略有差别，因此数值不会完全相同。

测试覆盖六层两帧、图书馆、校园和尖沙咀各一帧。最终结果和独立投影检查记录见本次更新说明；深度能生成不等于位姿能采用，没有完整独立真值时不能据此计算角度成功率。

大面积天空、动态物体、拼接畸变、车体遮挡、玻璃反射、点云时差及单目尺度/局部形变都会影响几何修正。当前深度图没有学习型不确定度，筛选属于工程几何诊断。现有粗位姿仍然必需；没有新增模型训练或蒸馏行为。

## 同事接手的文件

| 文件 | 职责 |
|---|---|
| `src/depthRegistration.ts` | XYZ 采样、HTTP 请求、候选二次检查 |
| `src/automaticRegistration.ts` | NID/DA² 候选类型和指标摘要 |
| `src/App.tsx`、`src/RegistrationWorkflow.tsx` | 方法切换、深度查看、预览/应用/舍弃与来源记录 |
| `scripts/depthGateway.mjs` | 本机 API、环境发现、并发限制、超时与取消 |
| `scripts/depth_worker.py` | 官方模型加载、真实深度推理和内容缓存 |
| `scripts/depth_geometry.py` | 独立可测的球面几何与尺度/位姿优化 |
| `scripts/setup_depth.py`、`scripts/da2-release.json` | 双平台隔离安装、固定版本、权重完整性校验 |
| `scripts/test_depth_geometry.py` | 坐标/像素中心、已知几何恢复和拒绝测试 |
| `scripts/test_depth_registration.mjs` | 请求验证、纯 XYZ 支持、候选门槛、可选真实模型端到端测试 |

## 来源

- 官方代码：https://github.com/EnVision-Research/DA-2
- 官方权重与 Apache-2.0 模型卡：https://huggingface.co/haodongli/DA-2
- 固定版本、大小和 SHA-256：`scripts/da2-release.json`

发布包提供安装脚本和模型接口，不包含调查数据、缓存、Python 环境或第三方大权重。请保留下载源码中的许可证和署名。
