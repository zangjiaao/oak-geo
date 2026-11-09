# 支撑端点抽检目录

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

本目录只含非核心端点，默认抽检；涉及原文/C类/配额的端点不得下沉。

- [brand](brand.md)：brand.read / brand.configure
- [user_member](user_member.md)：user_member.read / user_member.configure
- [seed_list](seed_list.md)：seed_list.read / seed_list.create / seed_list.revise
- [keyword_pool_snapshot](keyword_pool_snapshot.md)：keyword_pool_snapshot.read / keyword_pool_snapshot.append
- [intent_cluster](intent_cluster.md)：intent_cluster.read / intent_cluster.archive / intent_cluster.transition
- [opportunity_card](opportunity_card.md)：opportunity_card.read / opportunity_card.create / opportunity_card.recommend / opportunity_card.confirm / opportunity_card.transition
- [cluster_score](cluster_score.md)：cluster_score.append
- [cluster_platform_signal](cluster_platform_signal.md)：cluster_platform_signal.read / cluster_platform_signal.append
- [content_asset](content_asset.md)：content_asset.read / content_asset.create
- [claim_block](claim_block.md)：claim_block.read / claim_block.reject / claim_block.citations
- [probe_result](probe_result.md)：probe_result.read
- [metric_snapshot](metric_snapshot.md)：metric_snapshot.read / metric_snapshot.export / metric_snapshot.append
- [industry_score](industry_score.md)：industry_score.read / industry_score.revise
- [review_queue](review_queue.md)：review_queue.read / review_queue.submit / review_queue.withdraw
- [objection](objection.md)：objection.read / objection.create / objection.reject
- [backflow_ticket](backflow_ticket.md)：backflow_ticket.read / backflow_ticket.create / backflow_ticket.complete / backflow_ticket.expire
- [evidence_package](evidence_package.md)：evidence_package.read / evidence_package.approve / evidence_package.export
- [publish_registration](publish_registration.md)：publish_registration.read / publish_registration.transition
- [diagnosis_report](diagnosis_report.md)：diagnosis_report.read / diagnosis_report.create / diagnosis_report.approve / diagnosis_report.export / diagnosis_report.revise
- [offboarding](offboarding.md)：offboarding.read
- [deletion_ledger](deletion_ledger.md)：deletion_ledger.read
