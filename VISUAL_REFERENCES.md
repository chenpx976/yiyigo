# 围棋视觉参考审阅（2026-11-23）

本次实际查看 Shudan、Red Carpet Goban 的仓库截图，阅读这两个项目与 OGS Goban 的绘制源码。参考仓库在临时目录，不作为项目依赖；没有复制棋子图像或着色器代码。

| 项目 | 核对材料 | 值得借鉴 | 本项目取舍 |
| --- | --- | --- | --- |
| [Sabaki / Shudan](https://github.com/SabakiHQ/Shudan) | `screenshot.png`、`css/stone_-1.svg`、`css/stone_1.svg`、`css/goban.css`；MIT | 棋子接近棋格宽度，轮廓完整；白棋用连续渐变和短阴影，密集局面仍可逐颗辨认 | 借鉴比例及阅读层次，不复制其描边、偏蓝渐变或 SVG 贴图 |
| [OGS Goban](https://github.com/online-go/goban/blob/main/src/Goban/themes/rendered_stones.ts) | `phongShade`、`renderShadow`、Slate/Shell 主题；Apache-2.0 | 白棋 Shell 的镜面项远弱于黑棋 Slate；白棋的主要层次是法线与漫反射；阴影独立且贴近棋身 | 同一套材质模型不意味着必须用强烈白色高光表达白棋；继续保留低镜面反射，优先解决比例和落影 |
| [Red Carpet Goban](https://github.com/popojan/goban) | `res/screenshot.png`、`config/shaders/fragment/partial/material/red.glsl`；GPL-3.0 | 真正 3D 体积、棋盘与棋盒的整体材质关系、白棋肩部层次 | 只参考画面与设计原则，不复制 GPL 着色器；它的强高光、木纹和倾斜镜头不符合本项目当前要求 |

核对版本：Shudan `bf2be30c568338c77294a782742036c1b3167c72`；OGS `bc20d8021e914491c6b1d86ee687f4d413e81da5`；Red Carpet `2607d72e9fcf49d50519025efa55a9eb05cd9fc6`。

## 对当前实现的判断

此前反复调粗糙度、镜面强度，却没有先确定棋子占格比例与接触关系。原直径只有格距的 85%，连接需要填补较大的间隔，容易显得像胶条。当前改为 91%，根部起点同步移动，实连颈部保留在两子中点以下；不通过降低间隙到零来隐藏连接。主光抬高以缩短落影，减少悬浮感。

本轮没有照搬这些项目的渲染参数，也没有把其中任何一个作为“自然融合连接”的现成解决方案。实连、虚连及过渡仍是本项目自己的算法，必须继续在真实棋谱里验证。

## 验证

`npm run check`：39 项测试及生产构建通过；三份真实棋谱共 705 手回放通过。浏览器对照赵治勋 / 曹薰铉 2015 年棋谱第 150 手；视觉效果以截图和实际使用为依据，自动测试不能代替美术评价。
