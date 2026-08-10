from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit


OUT = "output/pdf/kokmatch_growth_roadmap.pdf"

PAGE_W, PAGE_H = A4
MARGIN_X = 46
TOP = PAGE_H - 46
BOTTOM = 42


pdfmetrics.registerFont(TTFont("AppleGothic", "/System/Library/Fonts/Supplemental/AppleGothic.ttf"))

FONT = "AppleGothic"

INK = colors.HexColor("#263142")
MUTED = colors.HexColor("#6F7A8A")
LINE = colors.HexColor("#DDE7F3")
BG = colors.HexColor("#F4F8FC")
BLUE = colors.HexColor("#5D8AE8")
BLUE_SOFT = colors.HexColor("#EAF2FF")
GREEN = colors.HexColor("#55B987")
GREEN_SOFT = colors.HexColor("#EAF8F0")
RED = colors.HexColor("#E57676")
RED_SOFT = colors.HexColor("#FFF0F0")
GOLD = colors.HexColor("#D8A642")
GOLD_SOFT = colors.HexColor("#FFF8E8")


def rounded(c, x, y, w, h, r=16, fill=colors.white, stroke=LINE, width=1):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(width)
    c.roundRect(x, y, w, h, r, fill=1, stroke=1)


def text(c, s, x, y, size=12, color=INK, font=FONT):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawString(x, y, s)


def centered(c, s, x, y, w, size=12, color=INK, font=FONT):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawCentredString(x + w / 2, y, s)


def wrap(c, s, x, y, w, size=11, leading=17, color=MUTED, font=FONT):
    c.setFont(font, size)
    c.setFillColor(color)
    lines = []
    for para in s.split("\n"):
        if not para:
            lines.append("")
        else:
            lines.extend(simpleSplit(para, font, size, w))
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def chip(c, label, x, y, fill, stroke, color=INK, w=None):
    c.setFont(FONT, 10)
    if w is None:
        w = c.stringWidth(label, FONT, 10) + 22
    rounded(c, x, y, w, 24, 12, fill=fill, stroke=stroke, width=1.2)
    centered(c, label, x, y + 7, w, size=10, color=color)
    return x + w + 8


def page_header(c, title, subtitle, page_no):
    text(c, "콕매치 성장 로드맵", MARGIN_X, TOP, 10.5, BLUE)
    text(c, title, MARGIN_X, TOP - 31, 24, INK)
    wrap(c, subtitle, MARGIN_X, TOP - 58, PAGE_W - MARGIN_X * 2, 10.5, 16, MUTED)
    c.setStrokeColor(LINE)
    c.line(MARGIN_X, TOP - 83, PAGE_W - MARGIN_X, TOP - 83)
    text(c, f"{page_no}", PAGE_W - MARGIN_X - 8, BOTTOM - 8, 9, colors.HexColor("#A1ACBA"))


def bullet_list(c, items, x, y, w, size=10.5, leading=16):
    for item in items:
        c.setFillColor(BLUE)
        c.circle(x + 3, y + 4, 2.5, fill=1, stroke=0)
        y = wrap(c, item, x + 14, y, w - 14, size=size, leading=leading, color=INK)
        y -= 5
    return y


def phase_card(c, idx, title, body, x, y, w, h, color, fill):
    rounded(c, x, y, w, h, 18, fill=fill, stroke=color, width=1.1)
    centered(c, str(idx), x + 14, y + h - 33, 34, 16, color=color)
    text(c, title, x + 60, y + h - 31, 13, INK)
    wrap(c, body, x + 60, y + h - 53, w - 78, 9.6, 14, MUTED)


def make_pdf():
    c = canvas.Canvas(OUT, pagesize=A4)
    c.setTitle("콕매치 성장 로드맵 제안")
    c.setAuthor("콕매치 / Codex")

    # Page 1
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    rounded(c, MARGIN_X, PAGE_H - 300, PAGE_W - MARGIN_X * 2, 230, 28, fill=colors.white, stroke=LINE, width=1)
    text(c, "콕매치", MARGIN_X + 28, PAGE_H - 125, 13, BLUE)
    text(c, "클럽 반응이 좋을 때", MARGIN_X + 28, PAGE_H - 165, 28, INK)
    text(c, "다음 진행 제안", MARGIN_X + 28, PAGE_H - 202, 28, INK)
    wrap(
        c,
        "바로 앱스토어 출시보다, 우리 클럽 실사용 검증에서 출발해 안정판을 만들고 "
        "신뢰할 수 있는 클럽으로 확장하는 순서가 안전합니다.",
        MARGIN_X + 28,
        PAGE_H - 235,
        PAGE_W - MARGIN_X * 2 - 56,
        11.5,
        18,
        MUTED,
    )
    x = MARGIN_X + 28
    y = PAGE_H - 277
    x = chip(c, "현장 검증", x, y, BLUE_SOFT, colors.HexColor("#C6DAFF"), BLUE)
    x = chip(c, "안정판", x, y, GREEN_SOFT, colors.HexColor("#CBEED9"), GREEN)
    chip(c, "클럽 확장", x, y, GOLD_SOFT, colors.HexColor("#F1DBA6"), GOLD)

    rounded(c, MARGIN_X, PAGE_H - 525, PAGE_W - MARGIN_X * 2, 178, 24, fill=colors.white, stroke=LINE, width=1)
    text(c, "핵심 판단", MARGIN_X + 24, PAGE_H - 386, 17, INK)
    bullet_list(
        c,
        [
            "콕매치는 이미 현장 문제를 풀고 있으므로, 기능 추가보다 실전 검증 데이터가 먼저입니다.",
            "초기 확장은 공개 배포보다 친한 총무·회장 중심의 제한 테스트가 적합합니다.",
            "가장 먼저 요구될 기능은 공동관리, 클럽별 명부, 운영 이력입니다.",
        ],
        MARGIN_X + 28,
        PAGE_H - 415,
        PAGE_W - MARGIN_X * 2 - 56,
    )

    rounded(c, MARGIN_X, 92, PAGE_W - MARGIN_X * 2, 165, 24, fill=colors.white, stroke=LINE, width=1)
    text(c, "한 줄 전략", MARGIN_X + 24, 218, 16, INK)
    wrap(
        c,
        "기능 많은 앱이 아니라, 총무가 덜 힘들고 회원이 더 공정하다고 느끼는 "
        "클럽 운영 도구로 자리 잡는 것이 가장 강한 포지션입니다.",
        MARGIN_X + 24,
        188,
        PAGE_W - MARGIN_X * 2 - 48,
        13,
        20,
        INK,
    )
    text(c, "2026.06.19", MARGIN_X + 24, 124, 9.5, MUTED)
    text(c, "1", PAGE_W - MARGIN_X - 8, BOTTOM - 8, 9, colors.HexColor("#A1ACBA"))
    c.showPage()

    # Page 2
    page_header(
        c,
        "추천 진행 순서",
        "검증을 작게 시작하고, 실전 안정성이 확인된 뒤 확장하는 방식입니다.",
        2,
    )
    y = TOP - 210
    card_w = (PAGE_W - MARGIN_X * 2 - 18) / 2
    phase_card(c, 1, "우리 클럽 3~5회 실전 운영", "민턴LIVE와 팀전LIVE를 실제 운동·월례전에서 돌려보고 불편한 순간을 기록합니다.", MARGIN_X, y, card_w, 105, BLUE, BLUE_SOFT)
    phase_card(c, 2, "친한 운영진 3~5명 제한 배포", "링크만 주지 말고 5분 설명, 샘플 명부, 피드백 질문지를 함께 제공합니다.", MARGIN_X + card_w + 18, y, card_w, 105, GREEN, GREEN_SOFT)
    y -= 125
    phase_card(c, 3, "안정판 고정", "민턴LIVE 안정판, 팀전LIVE 안정판, 실험판을 분리해 실전 당일 리스크를 줄입니다.", MARGIN_X, y, card_w, 105, GOLD, GOLD_SOFT)
    phase_card(c, 4, "공동관리 기능 개발", "주관리자, 보조관리자, 단장·부단장 권한을 나눠 관리자 부재 상황을 대비합니다.", MARGIN_X + card_w + 18, y, card_w, 105, RED, RED_SOFT)
    y -= 125
    phase_card(c, 5, "클럽별 명부 관리", "회원, 게스트, 급수, 출석 이력, 뒤풀이 기록을 클럽별로 정리할 수 있게 합니다.", MARGIN_X, y, card_w, 105, BLUE, BLUE_SOFT)
    phase_card(c, 6, "앱스토어·협회 제안", "PWA로 5~10개 클럽 검증 후 앱스토어와 시 협회 제안을 검토합니다.", MARGIN_X + card_w + 18, y, card_w, 105, GREEN, GREEN_SOFT)

    rounded(c, MARGIN_X, 96, PAGE_W - MARGIN_X * 2, 110, 20, fill=colors.white, stroke=LINE, width=1)
    text(c, "주의할 점", MARGIN_X + 20, 170, 14, INK)
    wrap(c, "반응이 좋을수록 기능 요청은 많아집니다. 하지만 바로 다 받아들이면 앱이 복잡해질 수 있습니다. 실전 안정성을 해치지 않는 요청부터 선별하는 것이 중요합니다.", MARGIN_X + 20, 146, PAGE_W - MARGIN_X * 2 - 40, 10.5, 16, MUTED)
    c.showPage()

    # Page 3
    page_header(
        c,
        "실사용 테스트 체크리스트",
        "처음 배포할 때는 좋은 평가보다 불안한 순간을 찾는 것이 더 중요합니다.",
        3,
    )
    left_w = (PAGE_W - MARGIN_X * 2 - 18) / 2
    y = TOP - 138
    rounded(c, MARGIN_X, y - 205, left_w, 205, 20, fill=colors.white, stroke=LINE)
    text(c, "회원 사용성", MARGIN_X + 20, y - 34, 15, BLUE)
    bullet_list(
        c,
        [
            "링크를 열고 본인 이름을 찾는 과정이 쉬운가",
            "버튼 의미를 설명 없이 이해하는가",
            "잘못 눌렀을 때 다시 바꿀 수 있다고 느끼는가",
            "스마트폰 화면에서 이름과 코트가 충분히 잘 보이는가",
        ],
        MARGIN_X + 22,
        y - 66,
        left_w - 44,
        9.8,
        15,
    )
    rounded(c, MARGIN_X + left_w + 18, y - 205, left_w, 205, 20, fill=colors.white, stroke=LINE)
    text(c, "관리자 운영성", MARGIN_X + left_w + 38, y - 34, 15, GREEN)
    bullet_list(
        c,
        [
            "상황판만 보고 현재 상태를 파악할 수 있는가",
            "예외 상황에서 수정 위치를 바로 찾는가",
            "경기 중에도 조작이 부담스럽지 않은가",
            "관리자가 운동 중일 때 대체자가 필요한가",
        ],
        MARGIN_X + left_w + 40,
        y - 66,
        left_w - 44,
        9.8,
        15,
    )

    y -= 240
    rounded(c, MARGIN_X, y - 190, PAGE_W - MARGIN_X * 2, 190, 20, fill=colors.white, stroke=LINE)
    text(c, "피드백 질문 5개", MARGIN_X + 22, y - 34, 15, INK)
    bullet_list(
        c,
        [
            "기존 방식보다 편했나요?",
            "처음 봤을 때 어렵거나 불안한 지점은 어디였나요?",
            "실전에서 꼭 필요하다고 느낀 기능은 무엇인가요?",
            "반대로 없어도 되는 버튼이나 문구는 무엇인가요?",
            "계속 쓴다면 클럽에서 어느 정도 비용을 부담할 수 있을까요?",
        ],
        MARGIN_X + 24,
        y - 66,
        PAGE_W - MARGIN_X * 2 - 48,
        10.2,
        16,
    )

    rounded(c, MARGIN_X, 84, PAGE_W - MARGIN_X * 2, 100, 20, fill=GREEN_SOFT, stroke=colors.HexColor("#CBEED9"))
    text(c, "첫 테스트 운영 팁", MARGIN_X + 20, 148, 14, colors.HexColor("#217C52"))
    wrap(c, "처음부터 완벽하게 설명하려 하지 말고, 회원에게는 버튼 3개만 알려주세요. 관리자는 상황판과 진행중 코트만 보고, 예외가 생겼을 때만 펼쳐서 수정하면 됩니다.", MARGIN_X + 20, 124, PAGE_W - MARGIN_X * 2 - 40, 10.5, 16, colors.HexColor("#36624E"))
    c.showPage()

    # Page 4
    page_header(
        c,
        "다음 개발 우선순위",
        "클럽 확장을 생각하면 가장 먼저 필요한 것은 권한 분리와 운영 안정성입니다.",
        4,
    )
    rows = [
        ("P1", "공동관리 모드", "주관리자, 보조관리자, 단장·부단장 권한을 나눠 관리자 부재에 대응합니다.", RED, RED_SOFT),
        ("P1", "운영 이력", "누가 출석을 바꿨고 누가 승패를 입력했는지 기록합니다.", RED, RED_SOFT),
        ("P2", "클럽별 명부 저장", "클럽마다 회원·게스트·급수·성별·연령 정보를 분리 관리합니다.", GOLD, GOLD_SOFT),
        ("P2", "튜토리얼 명부", "처음 쓰는 클럽이 샘플로 1분 체험한 뒤 실제 명부로 넘어가게 합니다.", GOLD, GOLD_SOFT),
        ("P3", "앱스토어 검토", "반복 사용 클럽이 생긴 뒤 신뢰도와 설치 편의성을 위해 검토합니다.", BLUE, BLUE_SOFT),
    ]
    y = TOP - 142
    for prio, title, body, color, fill in rows:
        rounded(c, MARGIN_X, y - 64, PAGE_W - MARGIN_X * 2, 64, 17, fill=fill, stroke=color, width=1)
        chip(c, prio, MARGIN_X + 16, y - 43, colors.white, color, color, w=44)
        text(c, title, MARGIN_X + 78, y - 27, 13.5, INK)
        wrap(c, body, MARGIN_X + 78, y - 47, PAGE_W - MARGIN_X * 2 - 100, 9.7, 13.5, MUTED)
        y -= 80

    rounded(c, MARGIN_X, 94, PAGE_W - MARGIN_X * 2, 145, 22, fill=colors.white, stroke=LINE)
    text(c, "협회·체육회에 소개할 때의 메시지", MARGIN_X + 22, 199, 15, INK)
    wrap(
        c,
        "동호인이 실제 월례대회와 평일 운동에서 겪는 대진·출석·운영 문제를 줄이기 위해 만든 현장형 도구입니다. "
        "먼저 몇 개 클럽에서 시범 운영하고, 결과를 바탕으로 시 단위 클럽 지원 시스템으로 확장할 수 있습니다.",
        MARGIN_X + 22,
        171,
        PAGE_W - MARGIN_X * 2 - 44,
        11,
        17,
        INK,
    )
    c.showPage()
    c.save()


if __name__ == "__main__":
    make_pdf()
