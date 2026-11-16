// Product-facing organization; official_fact.fact_category keeps its four
// existing scoring categories. These topics are independent of industry.
export const factTopics=Object.freeze({
 positioning:'产品定位',feature:'产品特色',function:'产品功能',pricing:'价格与计费',
 audience:'适用对象',scenario:'使用场景',integration:'接入方式',case:'客户案例',
 boundary:'服务范围与限制',service:'服务保障',
});
export const topicCategory=topic=>topic==='pricing'?'price':topic==='boundary'?'boundary':topic==='service'?'service_promise':'spec';
export const defaultTopic=category=>({price:'pricing',boundary:'boundary',service_promise:'service'})[category]??'function';
