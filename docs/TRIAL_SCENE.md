# 真实单场景试用（0.10.3）

**新版入口：**0.11.0 已增加同步观察和简洁配准流程，并将本机试用点云更新为 450 万点、55 m 范围。最新双平台操作、朝向粗初值和数据生成见 [同步观察与精细配准](SYNCHRONIZED_REGISTRATION.md)。下文保留 0.10.3 的旧场景参数供追溯。

试用场景来自本机尖沙咀 VMMS 数据，使用 `jianshazui_pano_1` 的 `001298` 帧为基准。点云与连续全景共用同一个局部坐标系，可以在左右视图分别标注、用同名点求解相机位姿、在多帧框选同一目标后尝试三角定位。

## 数据范围与能力边界

| 内容 | 本次提取 |
| --- | --- |
| 点云 | 有效原始 `pointcloud_5.pcd` 的局部 RGB 抽样，750,000 点 |
| 空间范围 | 基准 INS 位置周围水平 45 m，世界高度相对基准 −8 至 +45 m |
| 全景 | 11 张原始 8192×4096 JPG，001278–001318，每 4 帧取一张 |
| 时间跨度 | 约 2.667 s；采样相机轨迹长约 20.13 m |
| 位姿 | TREE 插值 INS，换算到基准帧局部坐标；单位米，+X 右、+Y 上、−Z 前 |
| 配准状态 | 平台共轴粗配准，未应用待确认的六自由度 CSV；零方位、杆臂、安装角待核验 |

当前自动精配准使用无权重球面 NID 本机后端；部署、输入条件、质量检查与限制见 [自动配准说明](AUTOMATIC_REGISTRATION.md)。已有粗位姿仍是前提，候选须人工核验。

## 打开试用包

两套私有试用包包含同一版平台、同一组真实数据和各自启动文件：

| 系统 | 文件名 | 解压后运行 |
| --- | --- | --- |
| Windows | `SCRI-Scene-JSZ001298-Windows.zip` | `Start-Scene-Windows.bat` |
| macOS | `SCRI-Scene-JSZ001298-macOS.zip` | `Start-Scene-macOS.command`，或 `sh ./Start-Scene-macOS.command` |

需要 Node.js 20+。完整解压后启动，终端会显示实际地址并打开 `?localScene=1` 页面。保持终端运行。服务仅监听 `127.0.0.1`，端口占用时自动换端口；不停止其他项目。

试用顺序：

1. 在“连续全景”切换帧，左右拖动检查点云与全景；向页面下方滚动可看到完整画布。
2. 点“投影核验”，检查建筑角点、灯杆等静态物体。按当前粗配准观察，不以车辆、行人为标定目标。
3. 选“同名点”，依次点左侧真实点云点与右侧同一地物，分散选至少四对，再求解当前帧位姿并查看投影；其他帧也要核验。
4. 人工标注可用“3D 框”框选拟合，选中框后用移动、尺寸、旋转手柄调整。
5. 选“多帧目标框”，在当前全景点目标框的两个对角；换相邻帧，保持同一对象并再次框选。至少两帧且位姿可靠后再三角定位，人工确认候选 3D 框。
6. 点击保存，再导出 JSON 留档。原始数据不被修改。

同一场景内容生成稳定任务 ID，刷新自动重载数据，并恢复当前浏览器已保存的标注与位姿。记录依赖浏览器来源（协议、主机、端口）；换浏览器、改端口或重新采样点云不保证继续使用原记录。导出结果用于备份。刷新默认回到基准全景帧。

## 源码目录启动

已准备好的场景保存在 Git 忽略的 `local-samples/trial-jsz-001298/`。构建后运行：

```powershell
# Windows PowerShell
npm run build
node scripts/serve.mjs --scene-dir local-samples/trial-jsz-001298 --port 43950
```

```sh
# macOS Terminal，先把同一 scene-data 目录复制到本机
npm run build
node scripts/serve.mjs --scene-dir "/path/to/scene-data" --port 43950
```

也支持启动前设置 `ATLAS_SCENE_DATA_DIR`，或把 `--scene-dir` 参数传给对应平台的 Start-Atlas 启动器。此入口属于构建后本机服务，`npm run dev` 不挂载它。常规浏览器文件导入入口仍可使用，但文件导入的任务刷新后需重选资产。

## 给开发同事：数据生成与接口

`scripts/prepare_trial_scene.py` 只读扫描有效 binary XYZRGB PCD，验证实际长度后按空间范围筛选，再用固定种子的分块均匀抽样保留最多 75 万点；不需要把整份约 1.5 GiB 点云载入内存。全景 JPG 直接复制，不缩放、不重压缩。输出包括逐帧 `registration.json`、来源元数据、预览图、SHA-256 清单及 Windows/macOS 数据包。已经存在的输出目录会拒绝覆盖。

依赖见 `scripts/requirements-extrinsics-validation.txt`。在单独的 Python 环境安装后运行，Windows 可以使用默认本机源路径；macOS 需显式指定复制后的源数据和 TREE 表：

```sh
python scripts/prepare_trial_scene.py --vmms "/path/to/20250210-jianshazui" --frames "/path/to/frame_coordinates.csv" --output "/path/to/new-scene"
```

生成平台包后，在源码目录执行下列命令，把私有场景装入两套完整试用包（输出到 `release/`）：

```sh
npm run build
npm run package
python scripts/package_scene_trial.py --scene "/path/to/scene-data"
```

`scripts/localSceneGateway.mjs` 从启动时明确指定的目录建立资产白名单，提供只读 `GET/HEAD /api/local-scene/manifest` 和 `/api/local-scene/asset/{cloud|panorama-N}`。清单不含本机绝对路径；不接受上传，也不提供任意路径读取。任务 ID 对位姿 JSON、点云及图像内容做哈希，数据变化后隔离已存点索引，避免把旧涂抹标签应用到重新抽样的点。

前端 `src/App.tsx` 在 `?localScene=1` 下读取清单，复用配准解析器与已有工作台，导入逐帧粗位姿并恢复保存状态；“恢复初始位姿”恢复对应帧的导入位姿。单元/HTTP 验证执行 `npm run test:local-scene`。

源码、接口、文档可通过 PR 共享。真实场景与两个含数据试用包保留在 Git 忽略目录内，不作为 GitHub Actions 的公开或团队下载附件自动发布；CI 的常规 Windows/macOS 平台包只带合成样本。若要共享实测数据，单独选择团队已授权的传输方式。
