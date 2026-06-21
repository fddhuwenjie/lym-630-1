# 车队维修保养与备件领用服务

Fleet Maintenance Service — 基于 Node.js + TypeScript + Express + SQLite 构建的车队车辆维修保养与备件管理后端服务。

---

## 目录

- [功能概述](#功能概述)
- [技术栈](#技术栈)
- [启动方式](#启动方式)
- [测试方式](#测试方式)
- [核心功能与验收点](#核心功能与验收点)
- [API 接口](#api-接口)
- [数据持久化说明](#数据持久化说明)
- [目录结构](#目录结构)

---

## 功能概述

服务提供完整的车队维修保养生命周期管理，覆盖以下核心域：

### 1. 车辆管理
- 车辆档案管理（车牌号、车型、购置日期、状态等）
- 里程登记（**拒绝里程读数倒退**）
- 车辆健康档案（健康评分、维修次数、保养次数、最近故障等级）

### 2. 保养计划自动生成
- **里程触发**：每 5,000 公里自动生成保养计划（达到阈值前 20% 提前提醒）
- **时间触发**：每 6 个月定期保养（到期前 30 天提前提醒）
- **故障触发**：重大 / 较严重故障自动生成故障维修保养计划

### 3. 维修工单流转
- 工单状态：`待派工 → 维修中 → 待验收 → 已完成`
- 可登记：诊断结果、工时、备件消耗、完工结果、验收结果
- 工单作废时**已领用备件自动退回仓库**
- **拒绝跳过验收直接完成**（维修中 → 必须先完工到待验收 → 再验收）

### 4. 备件库存与领用
- 备件档案（编码、名称、规格、单位、单价、预警阈值）
- 入库、领用、退回流水记录
- 库存预警查询（低于阈值的备件列表）
- **拒绝库存不足时领用**
- **拒绝同一工单重复领用同一备件**

### 5. 维修明细导出
- CSV 格式导出，包含：工单信息、工时、备件明细、故障原因、验收结果
- 支持按日期范围、车辆、状态筛选
- 导出记录持久化，支持重复下载

### 6. 业务规则校验（拒绝条件）
| 场景 | 错误码 | 说明 |
|------|--------|------|
| 车辆运行中开维修单 | `VEHICLE_RUNNING` | 车辆状态为 `running` 时禁止创建工单 |
| 备件库存不足 | `INSUFFICIENT_STOCK` | 领用数量 > 当前库存量 |
| 里程读数倒退 | `MILEAGE_ROLLBACK` | 新里程 < 已登记里程 |
| 未验收直接完成 | `INVALID_STATUS` | 不允许跳过完工流程直接验收 |
| 重复领用同一备件 | `DUPLICATE_PART` | 同一工单同一备件只能领用一次 |

---

## 技术栈

| 组件 | 技术选择 |
|------|---------|
| 运行时 | Node.js |
| 语言 | TypeScript 5 |
| Web 框架 | Express 4 |
| 数据库 | SQLite (better-sqlite3) |
| 测试框架 | Jest + ts-jest |
| CSV 导出 | csv-writer |
| 数据持久化 | SQLite WAL 模式，文件存储在 `data/` 目录 |

---

## 启动方式

### 环境要求

- Node.js >= 16
- npm >= 8

### 安装依赖

```bash
npm install
```

### 开发模式（热编译运行）

```bash
npm run dev
```

服务启动后默认监听 `http://localhost:3000`，可通过 `GET /health` 检查健康状态。

自定义端口：

```bash
PORT=8080 npm run dev
```

### 生产模式

```bash
npm run build   # 编译 TypeScript 到 dist/
npm start       # 启动编译后的 dist/index.js
```

---

## 测试方式

运行全部集成测试（共 37 个测试用例）：

```bash
npm test
```

测试覆盖以下模块：
- ✅ 车辆管理（创建、查询、里程登记、里程倒退拒绝、健康档案）
- ✅ 保养计划（里程触发、时间触发、故障触发、完成/取消）
- ✅ 工单流转（派工、诊断、工时、完工、验收、作废、备件退回）
- ✅ 备件管理（入库、领用、库存不足拒绝、重复领用拒绝、预警）
- ✅ 保养计划关联工单验收自动完成
- ✅ 导出功能
- ✅ 重启后数据一致性（工单、里程、备件流水、导出记录）

---

## 核心功能与验收点

### 验收清单

#### ✅ 车辆与里程
1. 可创建车辆档案，车牌号唯一校验
2. 车辆创建后自动生成健康档案（健康分 100，里程同步）
3. 里程登记时，**读数倒退被拒绝**（`MILEAGE_ROLLBACK`）
4. 里程登记后自动触发保养计划检查

#### ✅ 保养计划自动生成
5. 里程接近 5000 公里倍数时，自动生成 `mileage_based` 保养计划
6. 距上次保养满 6 个月（或购入满 6 个月）时，自动生成 `time_based` 保养计划
7. 重大/较严重故障创建工单时，自动生成 `fault_based` 保养计划
8. 小故障/中等故障不触发故障保养计划

#### ✅ 工单流转
9. **车辆运行中**创建工单被拒绝（`VEHICLE_RUNNING`）
10. 工单流转顺序：待派工 → 派工后变维修中，车辆同步变 `in_repair`
11. 维修中可登记诊断、工时、领用备件
12. 维修中完工后变待验收
13. 待验收验收后变已完成，车辆恢复 `idle`，**不允许跳过验收直接完成**
14. 工单作废后，已领用备件自动退回库存
15. 工单验收后，关联的保养计划自动标记完成
16. 工单验收后，更新车辆最后保养日期/里程，健康档案维修次数+1

#### ✅ 备件库存
17. 备件编码唯一校验
18. 入库/领用/退回均生成流水记录
19. **库存不足**领用被拒绝（`INSUFFICIENT_STOCK`）
20. **同一工单重复领用同一备件**被拒绝（`DUPLICATE_PART`）
21. 库存预警查询返回低于阈值的备件

#### ✅ 导出与查询
22. 维修明细导出为 CSV，包含工时、备件、故障原因、验收结果
23. 导出记录持久化，可查询历史导出、重复下载
24. 可查询车辆健康档案列表
25. 可查询到期保养计划
26. 可查询低库存预警备件

#### ✅ 数据一致性
27. SQLite 持久化，重启后所有数据（工单、里程、备件流水、导出记录）保持一致
28. 所有写操作使用事务，保证原子性

---

## API 接口

所有接口前缀：`/api`

### 车辆管理 `/api/vehicles`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/` | 创建车辆 |
| GET | `/` | 车辆列表，可传 `?status=running` 过滤状态 |
| GET | `/:id` | 车辆详情 |
| GET | `/plate/:plateNumber` | 按车牌号查询 |
| PUT | `/:id` | 更新车辆信息 |
| POST | `/:id/mileage` | 登记里程，Body: `{ mileage, operator }` |
| GET | `/:id/mileage-history` | 里程历史 |
| GET | `/health/all` | 全部车辆健康档案 |
| GET | `/:id/health` | 单辆车健康档案 |

### 保养计划 `/api/maintenance-plans`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 计划列表，可传 `?vehicleId=&status=` |
| GET | `/due` | 到期/即将到期计划 |
| GET | `/:id` | 计划详情 |
| POST | `/:id/complete` | 手动完成计划 |
| POST | `/:id/cancel` | 取消计划 |
| POST | `/vehicle/:vehicleId/generate` | 手动触发保养计划检查生成 |

### 维修工单 `/api/work-orders`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/` | 创建工单 |
| GET | `/` | 工单列表，可传 `?vehicleId=&status=` |
| GET | `/:id` | 工单详情 |
| GET | `/:id/detail` | 工单详情+备件明细 |
| POST | `/:id/assign` | 派工，Body: `{ assigned_to }` |
| POST | `/:id/diagnosis` | 登记诊断，Body: `{ diagnosis }` |
| POST | `/:id/labor-hours` | 登记工时，Body: `{ labor_hours }` |
| POST | `/:id/parts` | 领用备件，Body: `{ part_id, quantity, operator }` |
| POST | `/:id/complete` | 完工，Body: `{ completion_result }` |
| POST | `/:id/accept` | 验收，Body: `{ acceptance_result, accepted_by }` |
| POST | `/:id/cancel` | 作废，Body: `{ cancel_reason, operator }` |

### 备件管理 `/api/spare-parts`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/` | 创建备件 |
| GET | `/` | 备件列表，可传 `?keyword=` 搜索 |
| GET | `/low-stock` | 库存预警列表 |
| GET | `/:id` | 备件详情 |
| GET | `/code/:code` | 按编码查询 |
| PUT | `/:id` | 更新备件 |
| POST | `/:id/inbound` | 入库，Body: `{ quantity, operator, remark }` |
| GET | `/:id/transactions` | 备件流水 |
| GET | `/transactions/all` | 全部流水，可传 `?type=&work_order_id=` |

### 导出 `/api/exports`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/work-orders` | 导出维修明细，Body: `{ startDate?, endDate?, vehicleId?, status?, operator }` |
| GET | `/` | 导出历史记录 |
| GET | `/:id` | 导出记录详情 |
| GET | `/:id/download` | 下载导出的 CSV 文件 |

### 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 服务健康状态 |

---

## 数据持久化说明

所有数据存储在服务根目录的 `data/` 文件夹下：

```
data/
├── fleet_maintenance.db      # SQLite 主数据库（WAL 模式）
├── fleet_maintenance.db-wal  # WAL 日志
├── fleet_maintenance.db-shm  # 共享内存
└── exports/                  # 导出的 CSV 文件
    └── work_order_details_*.csv
```

**重启后数据保持一致**：服务重启后重新连接 SQLite 文件，所有历史工单、里程记录、备件流水、导出记录均完整保留。

---

## 目录结构

```
lym-630-1/
├── src/
│   ├── index.ts                      # 服务入口，Express 初始化
│   ├── types/
│   │   └── index.ts                  # 类型定义（Vehicle, WorkOrder, SparePart 等）
│   ├── database/
│   │   └── index.ts                  # SQLite 连接、建表 DDL
│   ├── utils/
│   │   └── index.ts                  # ID 生成、日期工具、BusinessError
│   ├── services/
│   │   ├── vehicleService.ts         # 车辆与健康档案
│   │   ├── maintenancePlanService.ts # 保养计划（自动生成逻辑）
│   │   ├── workOrderService.ts       # 工单流转
│   │   ├── sparePartService.ts       # 备件库存与流水
│   │   └── exportService.ts          # CSV 导出
│   └── routes/
│       ├── vehicles.ts
│       ├── maintenancePlans.ts
│       ├── workOrders.ts
│       ├── spareParts.ts
│       └── exports.ts
├── tests/
│   └── integration.test.ts           # 37 个集成测试
├── data/                             # 运行时生成
├── package.json
├── tsconfig.json                     # 生产构建配置（仅编译 src/）
└── jest.config.js                    # 测试配置（独立 tsconfig 覆盖）
```
