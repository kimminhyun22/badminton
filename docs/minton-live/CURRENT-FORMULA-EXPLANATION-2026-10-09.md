# 현행 계산식 설명 · 2026-10-09

확인 기준: 공개v781 c0113fa 및 로컬 시험 후보 functions/skill-calibration-core.js, js/match-quality.js. proposals 수식 동일; 후보만 measurementProposals 연결·상대3명 조건 추가. 산식·답안·운영점수 변경 없음.

B_i = round1(G_i - 1.5 F_i + A_i).
G: S7,A6,B5,C4,D3,E2. F: 여성1/남성0. A:20대0/30대-.2/40대-.5/50대-1.2/60대+ -2.
r_i = frozen initial skillRating if finite, else B_i + .2 skillStep_i. 실제65명 모두 초기skillRating없음, skillStep0 확인.
y_ij = (a+.5tie)/(a+b+tie); skip excluded. Distinct answered pair weight1.
s_i=r_i+x_i; p_ij=1/(1+exp(-(s_i-s_j))).
L = sum_pairs[-y log p-(1-y)log(1-p)] + .25/2 sum_i max(1,d_i)x_i².
d_i is answered opponent degree, including split opinions. Strict-majority resolved degree is a different metadata gate.
Initial x=0; simultaneous x_i -= g_i/(.25max(1,d_i)+.5d_i), g_i=.25max(1,d_i)x_i+sum_j(p_ij-y_ij). Up to2000 rounds; stop max update <1e-8. Round score3 decimals.
No explicit learned clipping; manual skillStep only integer[-4,4] (±.8). Display s+5; adjustment s-B. No demographic subtraction after learnedrating.
Candidate ready: answered comparison, connected strict-majority graph includes all rostergrades, ≥3 strict-majority different opponents, plus missing prior skillRating or absolute changedrating>.0005. Manager review remains; pilot no operational apply.
Constants and thresholds fixed, not trained by656 votes. x and y calculated fromvotes. Logistic opinion mapping not empirically verified match win probability. Single/10vote pair equalweights; tie halfwin; no judge trust weighting; owner36 not independent validation.

Explanation link: http://127.0.0.1:65302/?results=36&view=formula#formula
320/820/1440 existing readonly result verification:65rows,8focus,11cards, noJSerrors/POST/external/pageoverflow. Sourcehash unchanged. Native Chrome rendered formula screenshot /tmp/minton-formula-native-private.png visually checked.
Background reference https://www.jstatsoft.org/article/view/v048i09 . This custom degree regularization and uniform proportions differs from standard count-weighted MLE.
