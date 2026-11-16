import { APICallError } from 'ai';
import { ServiceError, validation } from './errors.mjs';

const stages = {
  model: '模型调用', search: '公开检索', fetch: '页面读取',
  result: '结果解析', evidence: '来源校验', save: '结果保存',
};
const messages = {
  authentication: 'DeepSeek 身份验证失败，请检查服务端 API Key',
  balance: 'DeepSeek 账户余额不足，请充值后重试',
  rate_limit: 'DeepSeek 请求被限流，请稍后重试',
  request: 'DeepSeek 拒绝了请求参数，请检查模型名称与调用配置',
  denied: 'DeepSeek 拒绝访问，请检查账号权限或目标页面访问限制',
  not_found: '模型或目标页面不可用，请检查模型名称或资料链接',
  upstream: 'DeepSeek 服务暂不可用，请稍后重试',
  timeout: '调查请求超时，请稍后重试',
  cancelled: '调查请求已中止，请重新发起',
  network: '调查网络连接失败，请检查服务器网络后重试',
  response: '公开来源接口返回格式异常，请稍后重试',
  too_large: '调查响应过大，请缩小资料范围后重试',
  budget: '本轮调查工具次数已用完，请缩小资料范围后重试',
  missing_tools: '模型未完成公开检索与页面读取，请重试',
  json: '模型未返回有效 JSON，请重新调查',
  evidence: '调查事实的来源或摘录未通过校验，请重新调查',
  input_changed: '调查开始前品牌资料已更新，请按最新资料重新调查',
  result_rejected: '调查结果未通过入库校验，请缩小资料范围或重新调查',
  save: '调查结果保存失败，请刷新查看后再试',
  unknown: '调查执行出现未识别错误，请稍后重试',
};
// Only fixed messages and numeric HTTP status are persisted or shown. Never
// propagate SDK response bodies, request prompts, URLs, headers or credentials.
export function researchFailure(category, stage = 'model', status) {
  category = Object.hasOwn(messages, category) ? category : 'unknown';
  stage = Object.hasOwn(stages, stage) ? stage : 'model';
  status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
  return validation(`${messages[category]}（${stages[stage]}${status ? `，HTTP ${status}` : ''}）`, {
    reason: 'product_research_failed', category, stage, upstream_status: status,
  });
}
export function upstreamResearchFailure(status, stage) {
  const category = {
    400:'request',401:'authentication',402:'balance',403:'denied',404:'not_found',
    408:'timeout',413:'too_large',422:'request',429:'rate_limit',504:'timeout',
  }[status] ?? (status >= 500 ? 'upstream' : 'unknown');
  return researchFailure(category, stage, status);
}
export function normalizeResearchFailure(error, stage = 'model') {
  const seen = new Set();
  for (let depth = 0; error && depth < 8 && !seen.has(error); depth++, error = error.cause) {
    seen.add(error);
    if (error instanceof ServiceError && error.details?.reason === 'product_research_failed')
      return researchFailure(error.details.category, error.details.stage, error.details.upstream_status);
    if (APICallError.isInstance(error) && Number.isInteger(error.statusCode))
      return upstreamResearchFailure(error.statusCode, stage);
    if (error.name === 'TimeoutError') return researchFailure('timeout', stage);
    if (error.name === 'AbortError') return researchFailure('cancelled', stage);
    if (['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(error.code))
      return researchFailure('timeout', stage);
    if (['ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN'].includes(error.code))
      return researchFailure('network', stage);
  }
  return researchFailure('unknown', stage);
}
export function describeResearchFailure(error, stage) {
  return normalizeResearchFailure(error, stage).message + '。原资料已保留，未生成新事实。';
}
