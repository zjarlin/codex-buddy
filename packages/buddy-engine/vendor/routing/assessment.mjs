import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectProject } from '../project-tools/index.mjs';

const exec = promisify(execFile);

// 离线兜底只做保守的下限判断：无法确认范围时按 advanced 处理，绝不据此授予执行权限。
// 真正的意图识别、工具路由和角色判断由 Host 的 System One 决策层负责。
export async function assess(input, cwd, project) {
  const reason = value => ({ tier: 'advanced', intent: 'general', reason: value, assessmentSource: 'local-fallback' });
  if (!Array.isArray(input) || input.some(item => item.type !== 'text')) {
    return reason('包含附件或非文本输入，缺少 System One 判断');
  }
  const text = input.filter(item => item.type === 'text').map(item => item.text || '').join('\n').trim();
  if (!text) return reason('没有可判断的文本');
  try {
    const report = project ?? (cwd ? await inspectProject(cwd) : null);
    if (report && (report.commands || []).length) {
      return { tier: 'standard', intent: 'project', reason: '已发现项目入口；System One 不可用时交由执行模型处理', assessmentSource: 'local-fallback' };
    }
  } catch { /* 项目探测失败不改变保守结论 */ }
  return reason('缺少 System One 判断，按需要规划处理');
}
