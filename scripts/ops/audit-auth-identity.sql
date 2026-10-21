-- Read-only aggregate audit: never output email addresses or provider subjects.
SELECT COUNT(*) AS email_collision_groups, COALESCE(SUM(n),0) AS affected_accounts
FROM (SELECT COUNT(*) AS n FROM user GROUP BY CASE WHEN lower(substr(trim(email),instr(trim(email),'@')+1)) IN ('gmail.com','googlemail.com') THEN replace(substr(substr(lower(trim(email)),1,instr(trim(email),'@')-1),1,instr(substr(lower(trim(email)),1,instr(trim(email),'@')-1)||'+','+')-1),'.','')||'@gmail.com' ELSE lower(trim(email)) END HAVING COUNT(*)>1);
SELECT COUNT(*) AS provider_collision_groups FROM (SELECT 1 FROM account GROUP BY providerId,accountId HAVING COUNT(*)>1);
