# 配准模块独立手册

修订日期：2026-11-10，第 3 版（操作图解版）；适用软件：0.15.0。

- [Windows 完整手册 PDF](Registration-Manual-Windows.pdf)
- [macOS 完整手册 PDF](Registration-Manual-macOS.pdf)
- [可维护的完整 Markdown 原稿](../REGISTRATION_MANUAL.md)
- [逐帧位姿 JSON 结构示例](../../examples/registration/poses-two-frames.json)

两份 PDF 对应软件 0.16.0，包含平台专用快速启动页、16 章正文、10 张操作图解、目录和分层书签。第 16 章新增 DA² 安装、方法切换、相对深度查看、候选核验与指标解释；完整模型 API 另见 [DA² 接入手册](../DEPTH_REGISTRATION.md)。第 4 章图解保留 0.15.0 界面，标出点击位置、顺序、完成后的状态与常见误操作。截图使用合成建筑教学样本，不是真实测区或新模型效果验收；没有复制真实测区影像、设备标定值或用户私有路径。

10 张图解依次覆盖浏览器导入、大点云预处理、同步/切帧/点大小、位姿参数、先左后右选点、分散选点与求解、撤销/删点/重选、独立投影核验、保存导出、自动配准候选流程。紫色编号和箭头是手册引导，黄色点号是应用原有的同名点 ID。自动服务截图来自已安装的本机 NID 后端；候选截图由合成样本的真实 NID 求解产生，下方审核流程为示意图，不代表测区精度验收。

## 维护与再生成

仅修改本目录的 PDF 会造成文档难以维护。请修改上方 Markdown 原稿，再用构建脚本同时生成两个平台版本。安装文档专用依赖时请使用自己的虚拟环境，不需要修改平台模型环境：

```text
python -m pip install -r scripts/requirements-manual.txt
python scripts/build_registration_manual.py --font PATH_TO_CJK_TRUETYPE_FONT
python scripts/check_registration_manual.py
```

构建支持可嵌入的中文 TrueType 字体/字体集合。Windows 默认尝试系统微软雅黑，字体本身不会复制到仓库；其他系统可用 --font 指定本机具有相应授权的中文字体。无可用字体时回退到 STSong-Light CID，阅读器需要具备 CJK 支持，交付前须重新渲染检查。

图示来源与维护：`figures/` 的 PNG 为当前软件实际截图，`figures.json` 指定裁切区域、排列、编号、箭头和示意形状；`scripts/manual_illustrations.py` 将同一份定义用于 PDF 矢量叠加和 Markdown 的独立 SVG。更新界面后重新通过正常 UI 操作截图，再调整定义并运行构建，不要在截图上伪造按钮、点对数或求解结果。截取的是共用网页，macOS 启动说明独立维护，不表示已经在实体 Mac 复测图形性能。

最终本地交付文件位于 output/pdf/，脚本另同步到本目录以随 PR 发布。build-manifest.json 记录原稿、两个渲染脚本、全部图示资产和两份 PDF 的 SHA-256 与页数。文本校验先统一 LF 换行，PDF/PNG 按原始二进制校验，兼容 Windows/macOS 检出差异。CI 检查原稿链接、10 张图示、渲染脚本与两版 PDF 是否同步；普通软件 ZIP 也包含完整的图示子目录，离线阅读不会缺图。

每次实质修改后用 Poppler pdftoppm 渲染所有页面，检查中文、代码块、表格、目录、书签和分页。对位姿提取示例运行 `python scripts/test_extract_registration_poses.py`；对 JSON 导入契约运行 `npm run test:registration`。
