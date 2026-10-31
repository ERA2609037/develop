'use strict';

/**
 * LifeContextAggregator
 *
 * 职责（对应需求 13）：
 *   1. 从既有模块检索数据（交给 DataProvider）
 *   2. 按报告周期过滤
 *   3. 归一化数据结构
 *   4. 处理缺失记录（各 provider 返回 missing/空值，不编造）
 *   5. 构建给 AI 的结构化上下文
 *   6. 去重（按 id 去重，避免重复记录进入上下文）
 */

function createAggregator(providers, ctx) {
  const { nowStr, localDateStr } = ctx;

  function dedupe(list) {
    if (!Array.isArray(list)) return list;
    const seen = new Set();
    return list.filter((x) => {
      if (!x || x.id === undefined) return true;
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  }

  function build({ type, from, to, today, options }) {
    const opts = options || {};
    const sources = opts.sources || {};
    const diaryEnabled = !!opts.diaryEnabled;
    const currency = opts.currency || '¥';
    const day = today || localDateStr();

    const data = {};
    data.todos = sources.todos !== false ? providers.todos({ today: day, from, to }) : null;
    data.calendar = sources.calendar !== false ? providers.calendar({ today: day, from, to }) : null;
    data.finance = sources.finance !== false ? providers.finance({ today: day, from, to, currency }) : null;
    data.lifestyle = sources.lifestyle !== false ? providers.lifestyle({ today: day, from, to }) : null;
    data.diary = (sources.diary !== false) ? providers.diary({ from, to, enabled: diaryEnabled }) : { enabled: false };

    // 去重（providers 内部已按主键聚合，这里对可能的数组字段做防御性去重）
    if (data.todos) {
      data.todos.top = dedupe(data.todos.top);
      data.todos.overdueList = dedupe(data.todos.overdueList);
      data.todos.highList = dedupe(data.todos.highList);
    }

    return {
      type,
      period: { from, to },
      today: day,
      currency,
      data,
      privacy: { diaryEnabled },
      generatedAt: nowStr(),
    };
  }

  return { build };
}

module.exports = { createAggregator };
