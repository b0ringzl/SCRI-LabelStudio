# 无权重球面自动精配准 · 0.15.0

已部署的是项目独立实现的球面 NID（归一化信息距离）CPU 后端，参考 [直接 LiDAR–相机标定项目](https://github.com/koide3/direct_visual_lidar_calibration)的公开方法思路。它不加载神经网络权重，不依赖 CUDA，不是 Koide 官方 C++ 可执行程序。官方 Docker 镜像在本机尝试时因 Docker Desktop 自身服务文件访问错误未能启动；没有重置 Docker 或修改 TREE 环境。

## Windows / macOS 安装

完整解压对应平台包，需要 Node.js 20+、Python 3.10+ 和首次安装依赖的网络连接。

| 系统 | 安装配准依赖 | 打开平台 |
| --- | --- | --- |
| Windows | 双击 `Setup-Registration-Windows.bat` | 双击 `Start-Atlas-Windows.bat` |
| macOS | `sh ./Setup-Registration-macOS.command` | `sh ./Start-Atlas-macOS.command` |

安装器只创建包目录下的 `.venv-registration`，不修改全局 Python、TREE 或其他项目环境。把 ZIP 解压到独立且可写的目录，移动目录后重新安装该环境。也可以通过进程环境变量 `ATLAS_REGISTRATION_PYTHON` 指定自己的 Python 可执行文件绝对路径。依赖为 NumPy、SciPy 和 OpenCV headless。macOS 与 Windows 使用同一算法，CI 对两种系统运行已知位姿恢复测试；实体 Mac 图形性能仍需验证。

服务绑定 `127.0.0.1`，端口冲突时选择后续可用端口，不结束其他项目。影像、采样点和位姿只发送给本机 Node 网关及本机 worker。安装依赖访问 Python 包源；算法请求不调用云端模型。

## 操作流程

1. 在“数据”导入点云、连续 2:1 全景及逐帧粗位姿 JSON，或打开本机预处理场景。粗位姿须来自已确认的硬件外参、INS/SLAM 或手动同名点；轴向、单位、帧号必须匹配。
2. 进入“配准 → 粗配准”，点击“自动精配准”。更多设置中可批量处理全部帧，并查看真实依赖检查状态。
3. 运行期间显示当前帧，可以取消。修改正式位姿、切换数据任务或导入新数据会取消旧请求；迟到结果不会覆盖新任务。
4. 通过检查后出现候选，默认只预览。用“查看原位姿 / 预览候选”比较建筑边缘、不同方向与距离的静态地物。
5. 更好时“应用当前候选”；不合适则“舍弃候选”。应用后相关多帧目标旧定位标为过期，重新定位核验再保存、导出。
6. 批量运行逐帧串行，失败帧保留原位姿。取消会终止当前 Python 子进程，已完成候选仍可检查；未应用队列不持久化。

主流程保留“粗配准 → 同名点精调 → 投影核验”。自动精配准是减少手工调整的候选生成器，不是无初值全局定位或自动精度认证。

## 算法与质量检查

浏览器从原始几何按固定规则采样：相机附近 1.5–75 m、最多 28000 点；使用真实 intensity，缺失时才用原始 RGB 亮度。高程色、强度伪彩和人工标签色不能当成 RGB 信号。全景缩至 1536×768，球面横向接缝循环采样。

Python 基于粗位姿筛选近表面可见点，分成 75% 优化 / 25% 交错留出样本；使用 Parzen 联合直方图 NID、多起点有界 Powell 优化，估计六自由度局部修正。平移每轴 ±0.8 m；局部旋转向量每轴 ±6°，不是欧拉角逐轴界限。当前质量门限：

- 优化 NID 降低 >0.001，留出 NID 降低 >0.0005。
- 留出 NID <0.985，且比 ±15°/±30° 错误朝向对照的中位 NID 好 >0.003。
- 有效可见点 ≥1000，总位置修正 <1.25 m，总旋转修正 <8°，参数未触及搜索边界。

门限是保守的启发式筛选，不是概率置信度。留出点来自同一帧，不是独立真值；NID 小不等于实际角度误差小。初值偏差大、重复纹理、玻璃、遮挡、时变物体、强度与光学灰度关系弱时可能拒绝或产生错误候选。现阶段不支持跨帧共享外参联合优化，也不承诺 ≤4°；该目标需独立控制点/真实位姿验收。

## 本机四场景实测（2026-11-10）

统一参数对四组已准备场景的首、中、末帧运行，没有逐场景硬编码角度或调门限。以下只报告优化诊断，无私有媒体或精确测区位姿。

| 场景 | 运行帧数 | 通过候选筛选 | 保留原位姿 | 原因摘要 |
| --- | --- | --- | --- | --- |
| 校园 XYZI | 3 | 0 | 3 | 留出 NID 约 0.989，信号弱 |
| 六层 XYZI | 3 | 2 | 1 | 两帧留出 NID 约 0.984；另一帧证据不足 |
| 图书馆 XYZI | 3 | 0 | 3 | 留出 NID 约 0.988–0.991，信号弱 |
| 尖沙咀 XYZRGB | 3 | 0 | 3 | 小幅改善对比错误朝向不显著 |

本机优化约 0.8–1.6 秒/帧，不包含媒体读取、浏览器准备及 Python 冷启动。12 帧源点云 SHA-256 前后相同。2 个候选没有独立精度验收，不能称为成功配准；此路线尚不能免除现有数据的大部分人工操作。已知真值的独立合成测试中，对约 3.4°、0.23 m 扰动完成恢复，自动断言旋转误差 <1.5°、位置误差 <0.35 m。

另在工作台通过正常 UI 运行六层 7 帧批处理，5 帧生成候选、2 帧保留原位姿，未批量应用。浏览器缩放/编码与离线 OpenCV 准备有差异，边界候选状态也会变化；这进一步说明分数筛选不等于稳定的几何精度。合成教学场景完成了“运行 → 原位姿对比 → 应用 → 保存”的完整界面验证。

本机复测：`.venv-registration` 的 Python 运行 `scripts/validate_automatic_registration.py`。详细结果只写入忽略目录 `local-samples/automatic-registration-validation`，不会改写原始数据。不要把已有 SLAM 初值当作独立真值。

## 接口与维护入口

`GET /api/registration/automatic` 执行实际 worker 依赖检查，返回 `configured`、`weightsRequired:false`、`algorithmVersion`、失败原因。不存在环境时按钮禁用。

`POST /api/registration/automatic` 请求上限 12 MiB：

```json
{
  "schemaVersion": "registration/2.0",
  "frameId": "frame-001",
  "prior": {"position": [0,0,0], "rotation": [0,0,0]},
  "signal": "intensity",
  "points": [[1,2,-8]],
  "values": [42],
  "imageDataUrl": "data:image/jpeg;base64,..."
}
```

示例省略数组，实际须 1000–40000 个有限 XYZ 和等长 values。坐标单位米；相机坐标 +X 右、+Y 上、-Z 前；prior 是 camera-to-cloud，rotation 顺序 yaw/pitch/roll，角度制、YXZ 内禀旋转。RGB 时 signal 为 `rgb-luminance`。

响应包含同一 frameId、`status:candidate|rejected`、reason、registration、algorithmVersion、signal、metrics、`independentlyVerified:false`。metrics 含 nidBefore/After、holdoutBefore/After、controlNid、contrast、visiblePoints、rotationChangeDeg、positionChangeM、durationSeconds、starts。拒绝响应的 registration 仅供诊断，不得应用。非法输入 422、未安装 503、并发忙 409、跨源/缺失 Origin 的 POST 为 403、错误方法 405；180 秒网关超时，客户端断开终止 worker。

| 文件 | 职责 |
| --- | --- |
| `src/automaticRegistration.ts` | 真实信号采样、影像准备、请求、候选复核 |
| `scripts/registrationGateway.mjs` | 本机协议、输入验证、串行互斥、取消与超时 |
| `scripts/registration_worker.py` | 独立球面 NID 六自由度求解 |
| `scripts/setup_registration.py` | 隔离环境安装与依赖检查 |
| `src/App.tsx` / `RegistrationWorkflow.tsx` | 当前/批量候选、预览、应用、下游过期标记 |

验证命令：`npm run test:automatic-registration`、独立环境运行 `python scripts/test_registration_worker.py`，其余配准/同步/轮廓回归按 CI 执行。接口版本和算法版本分别维护；更换算法时保留候选审核、失败保留初值及坐标契约。
