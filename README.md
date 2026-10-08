# Atlas Studio · 点云与全景联合标注原型

一个参考 Label Studio 工作流的前端原型，用于室内外建筑组件、标志和地物的多源标注。当前阶段实现界面、配对数据导入、配准核验、人工标注和预标注服务接口定义，尚未接入 AI 模型或服务端数据库。

## 本地打开

需要 Node.js 20+。两平台共用同一套前端代码，提供分别可启动的交付 ZIP：

| 系统 | 解压后启动文件 | 平台说明 |
| --- | --- | --- |
| Windows | `Start-Atlas-Windows.bat` | [Windows 版说明](docs/README-Windows.md) |
| macOS | `Start-Atlas-macOS.command` | [macOS 版说明](docs/README-macOS.md) |

ZIP 已包含构建结果与示例数据。启动脚本会在本机开启网页并用默认浏览器打开；窗口关闭后服务停止，因此先前的本地地址不能永久访问。服务只绑定 `127.0.0.1`，默认从 43127 端口开始尝试，占用时自动改用下一个可用端口。以窗口显示的实际地址为准。

在源码目录也可直接运行对应系统的启动文件，它会先构建再打开。开发时运行 `npm ci`、`npm run dev`；生成两个交付包使用 `npm run build`、`npm run package`（需要 Python 3），文件输出到 `release/`。

## GitHub 协作

源码、可共享的合成演示数据、双平台启动脚本和打包脚本可放入同一个 GitHub 仓库。`node_modules/`、`dist/`、`release/` 及真实尖沙咀裁剪样本不提交；每次推送或发起 PR 后，[构建工作流](.github/workflows/build.yml)检查 TypeScript 和打包，并上传两个 ZIP 作为 Actions artifacts。协作者按 [贡献指南](CONTRIBUTING.md)提交 PR。模型与界面协作分别参阅 [模型接口契约](docs/MODEL_API.md) 和 [UI 设计说明](docs/UI_DESIGN.md)。

## 已实现的工作流

1. **任务列表 / 数据源**：每项任务配对一份 PCD 或 PLY 点云、一张 2:1 等距柱状全景 JPG 或 PNG，以及可选的配准 JSON。浏览器直接导入的点云上限为 150 MB。
2. **左右同步工作台**：左侧 Three.js 三维点云，右侧可环视的球面全景。两视图始终同时显示，可以分别交互。
3. **共享对象标注**：点云单击创建默认 3D 框，或拖拽矩形从选区点拟合中心、尺寸与水平旋转角；全景点击创建点，或逐点绘制多边形。选中已有对象后去另一视图绘制，两份标注共享同一个 `OBJ-*` ID。右侧可编辑类别、名称、3D 框中心、尺寸和 Yaw。
4. **直接编辑 3D 框**：选中框后，在点云左下方切换“移动 / 尺寸 / 旋转”，拖动三维手柄调整；“定位到框”会靠近目标，方便微调。旋转限制为水平 Yaw，右侧数值仍可精确输入。
5. **逐点类别涂抹**：先选类别，切换“点云涂抹”后拖动笔刷；Shift 拖拽框选，Alt 拖动擦除，支持撤销上一步。结果给原始点索引分配类别，并在点云中着色，与对象 3D 框并存。逐点结果保存于当前浏览器，也包含在导出的 JSON 中。见 [简化标注流程](docs/labeling-workflow.md)。
6. **配准校验**：将稀疏点云投影到全景上，并调整相机位置及 yaw、pitch、roll。点云中显示相机位置标记。
7. **类别与结果**：可添加类别；数字键 1–9 切换对应类别。标注和配准参数可保存到当前浏览器的 `localStorage`，或导出包含两种模态结果的 JSON。
8. **预标注接口**：`src/prelabel.ts` 定义 `PrelabelProvider`、资产上传和 HTTP `POST /predict` 适配器；目前界面只保存服务地址，不调用模型。

点云标注交互参考 [SUSTechPOINTS 的操作说明](https://github.com/naurril/SUSTechPOINTS/blob/dev-auto-annotate/doc/operations.md)：可切换透视、俯视和正视，选择 3D 框后直接拖拽拟合；在浏览模式下也可按 Ctrl 拖拽。点击现有框可选中对象，点大小按钮用于检查稀疏细节，“聚焦”可压暗框外点。选中框后方向键平移，PageUp/PageDown 升降，Q/E 旋转，Delete 删除，Esc 取消选择。当前拟合使用水平 PCA 与分位数边界，未采用 SUSTechPOINTS 的 region grow 实现；没有复制其源码。

本地导入使用浏览器 `blob:` URL，导入任务在刷新页面后需要重新选择文件。要接入远端推理服务，需先建立上传或可访问资产 URL 的后端流程，不能直接把 `blob:` URL 交给服务端。

## 演示数据与真实样本配准依据

GitHub 仓库默认提供 `public/demo-cloud.pcd` 和 `public/demo-panorama.png`，由 `python scripts/create_synthetic_demo.py` 生成，不对应任何真实地点。若本机源码目录存在 `public/sample-cloud.pcd` 和 `public/sample-panorama.jpg`，工作台优先打开真实裁剪样本；否则自动使用合成样本。真实样本已在 `.gitignore` 中排除，双平台 ZIP 打包脚本也默认排除它；发布前须单独确认数据分享权限。

内置示例来自 `20250210-jianshazui` 的 Ladybug 全景帧 `001298`。`scripts/prepare_vmms_sample.py` 读取本机 TREE 项目的 `frame_coordinates.csv`，用该帧的插值 INS 位姿把相机附近 42 m 的映射点云变换为相机局部系，再从附近的降采样 PCD 中选取最多 100,000 点。处理后文件位于 `public/sample-cloud.pcd`、`public/sample-panorama.jpg` 和 `public/sample-metadata.json`。脚本只读取原始数据，不修改原目录。

局部坐标约定为 **+X 向右、+Y 向上、−Z 向前**。与 TREE 的 Ladybug 球面投影约定对应：

```text
u = 0.5 − atan2(left, forward) / (2π)
v = 0.5 − asin(up / distance) / π
```

这一初始配准由平台 INS 位姿和周边映射点云生成。现有数据中没有经过独立标定的 LiDAR 到 Ladybug 杆臂及安装角，因此它是**粗配准**；投影叠加用于人工检查，界面中的位置和角度调节可补偿局部偏差。示例点云是站点周围的局部抽样，不能代表整份原始多 GB 点云或严格同一时刻的单帧扫描。

如需重新生成内置样本，在原始 VMMS 与 TREE 数据仍位于本机指定路径时运行：

```powershell
python .\scripts\prepare_vmms_sample.py
```

也可通过 `--vmms`、`--frames`、`--output`、`--stream`、`--frame`、`--radius`、`--max-points` 指定其他数据。

## 导入配准 JSON

点云坐标与相机位置必须处于同一个坐标系，示例数据格式：

```json
{
  "position": [0, 0, 0],
  "rotation": [0, 0, 0]
}
```

`rotation` 依次为 yaw、pitch、roll，单位为角度。零旋转时相机朝 −Z。可以直接传这个对象，也可以包在 `{ "registration": { ... } }` 中。导入普通 PCD/PLY 时不会自动根据拍摄时间求外参；需要提供相机位姿或在配准页手动核验。

## 目录

- `src/App.tsx`：任务管理、标注工具、属性面板、配准页和数据导入。
- `src/PointCloudView.tsx`：PCD/PLY 三维显示及 3D 框拾取。
- `src/PanoramaView.tsx`：全景球面显示、点和多边形绘制、点云投影叠加。
- `src/geometry.ts`：坐标变换、球面投影和近射线点查询。
- `src/boxFitting.ts`：点云选区初始拟合、旋转框内点检测与计数。
- `src/types.ts`：任务、类别、配准、联合标注和模型接口数据类型。
- `src/prelabel.ts`：未来模型服务适配器。
- `scripts/prepare_vmms_sample.py`：内置真实样本预处理。

当前标注工具是界面和数据契约原型：3D 框支持水平旋转，全景支持点和多边形，点云支持手工逐点分类；框选拟合仅提供初值，混杂背景时需要人工修正。逐点分类依据导入后点的索引，重新采样同一文件后索引可能变化。尚无自动地面分离、平面检测、连通组件分割、跨视图自动关联、精配准求解、批量任务持久化、多人协作或模型推理。
