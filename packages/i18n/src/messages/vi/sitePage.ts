import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "Trang này không thể tải được",
  "sitePage.error.body": "Kiểm tra kết nối và tải lại trang. Nếu vẫn không tải được, hãy quay lại trang chủ.",
  "sitePage.error.reload": "Tải lại trang",
  "sitePage.error.home": "Quay lại trang chủ",
  "sitePage.join.title": "Tham gia một máy chủ OpenBot",
  "sitePage.join.description": "Mở lời mời máy chủ riêng tư trong OpenBot.",
  "sitePage.join.eyebrow": "Lời mời riêng tư",
  "sitePage.join.intro":
    "Mở lời mời này trong OpenBot. Ứng dụng kiểm tra máy chủ và yêu cầu bạn xác nhận trước khi kết nối.",
  "sitePage.join.invalid":
    "Liên kết lời mời này không hợp lệ hoặc không đầy đủ. Hãy nhờ chủ sở hữu máy chủ gửi lời mời mới.",
  "sitePage.join.open": "Mở OpenBot",
  "sitePage.join.browser": "Mở trong trình duyệt",
  // {browser} and {download} are links. Their text is browserLink and downloadLink.
  "sitePage.join.noApp": "Chưa có ứng dụng? {browser} hoặc {download}.",
  "sitePage.join.noAppMobile": "Chưa có ứng dụng? {browser}.",
  "sitePage.join.browserLink": "Tham gia trong trình duyệt này",
  "sitePage.join.downloadLink": "tải OpenBot",
  // {open} is the label of the button that did not open OpenBot.
  "sitePage.join.notOpened":
    "Nếu OpenBot đã có trên máy tính này, hãy khởi động nó rồi nhấn {open} lại. Nếu chưa có, hãy tải OpenBot trước.",
  // {open} is the label of the button above this note.
  "sitePage.join.mobile":
    "Nếu đã cài OpenBot, hãy chạm {open}. Bạn cũng có thể dán liên kết này vào Thêm máy chủ trong ứng dụng.",
  "sitePage.join.email": "Nếu lời mời được gửi qua email, hãy đăng nhập vào OpenBot bằng địa chỉ email đó.",
  // {name} is Slack or Discord on all the connect keys.
  "sitePage.connect.title": "Quay lại OpenBot",
  "sitePage.connect.failedTitle": "Kết nối chưa hoàn tất",
  "sitePage.connect.openApp": "Mở OpenBot",
  "sitePage.connect.tryAgainApp": "Thử lại trong OpenBot",
  "sitePage.connect.tryAgainBrowser": "Thử lại trong trình duyệt",
  "sitePage.connect.doneInWebClient": "Tab OpenBot của bạn hoàn tất kết nối {name}. Bạn có thể đóng tab này.",
  "sitePage.connect.doneInApp": "OpenBot hoàn tất kết nối {name} trên máy tính của bạn.",
  "sitePage.connect.failure.cancelled": "Kết nối {name} đã bị hủy. Không có gì thay đổi.",
  "sitePage.connect.failure.expired": "Phiên đăng nhập {name} đã hết hạn. Hãy bắt đầu kết nối lại.",
  "sitePage.connect.failure.exchange": "{name} không xác nhận kết nối. Hãy thử lại.",
  "sitePage.connect.failure.enterprise": "Kết nối một không gian làm việc Slack, không phải cả một tổ chức.",
  "sitePage.connect.failure.takenSlack":
    "Một máy chủ OpenBot khác đã phản hồi cho không gian làm việc Slack này. Hãy ngắt kết nối nó trên máy chủ đó rồi thử lại.",
  "sitePage.connect.failure.takenDiscord":
    "Một máy chủ OpenBot khác đã phản hồi cho máy chủ Discord này. Hãy ngắt kết nối nó trên máy chủ đó rồi thử lại.",
  "sitePage.connect.failure.unavailable": "OpenBot không thể kết nối {name} lúc này. Hãy thử lại sau.",
  "sitePage.connect.failure.tabClosed":
    "Tab OpenBot đã bắt đầu kết nối {name} không phản hồi. Hãy mở OpenBot trong trình duyệt và kết nối {name} lại.",
  "sitePage.connect.failure.failed": "{name} không hoàn tất kết nối. Hãy thử lại.",
  // {marketplace}, {apps} and {connect} are the names of these screens and that button in the app.
  "sitePage.connect.restartHint": "Trong OpenBot, mở {marketplace}, rồi {apps}, rồi {name}, và chọn {connect}.",
  "sitePage.connect.notOpened":
    "Hãy khởi động OpenBot rồi thử lại. Nếu OpenBot không có trên máy tính này, hãy tải OpenBot và kết nối {name} trong ứng dụng.",
  "sitePage.openApp.title": "Không có gì mở ra?",
  "sitePage.openApp.dismiss": "Để sau",
  "sitePage.billing.pageTitle": "Thanh toán OpenBot",
  "sitePage.billing.updatedTitle": "Đã cập nhật thanh toán",
  "sitePage.billing.updatedBody": "Quay lại OpenBot. Bạn có thể đóng trang này.",
  "sitePage.billing.cancelledTitle": "Đã hủy thanh toán",
  "sitePage.billing.cancelledBody": "Không có khoản phí nào được tính. Quay lại OpenBot.",
  "sitePage.report.pageTitle": "Báo cáo một trang được lưu trữ — OpenBot",
  "sitePage.report.title": "Báo cáo một trang được lưu trữ",
  "sitePage.report.intro": "Gửi báo cáo về nội dung gây hại hoặc vi phạm pháp luật trên một địa chỉ openbot.site.",
  "sitePage.report.hostnameLabel": "Địa chỉ trang web",
  "sitePage.report.hostnameMissing": "Nhập địa chỉ trang web",
  "sitePage.report.reasonLabel": "Lý do",
  "sitePage.report.reason.phishing": "Phishing",
  "sitePage.report.reason.malware": "Phần mềm độc hại",
  "sitePage.report.reason.abuse": "Lạm dụng",
  "sitePage.report.reason.copyright": "Bản quyền",
  "sitePage.report.reason.other": "Khác",
  "sitePage.report.detailsLabel": "Chi tiết",
  "sitePage.report.optional": "Tùy chọn",
  "sitePage.report.detailsPlaceholder": "Trang này có vấn đề gì?",
  "sitePage.report.send": "Gửi báo cáo",
  "sitePage.report.sending": "Đang gửi…",
  "sitePage.report.tooMany": "Quá nhiều báo cáo. Hãy thử lại sau.",
  "sitePage.report.sendFailed": "Không thể gửi báo cáo. Hãy thử lại.",
  // {email} is the contact address. The page shows it as a link.
  "sitePage.report.writeTo": "Bạn cũng có thể gửi email đến {email}.",
  "sitePage.report.sentTitle": "Đã gửi báo cáo",
  "sitePage.report.sentBody": "Cảm ơn bạn. Chúng tôi đã nhận được báo cáo của bạn.",
  "sitePage.report.home": "Đến trang chủ",
  "sitePage.pricing.title": "Bảng giá OpenBot",
  "sitePage.pricing.description":
    "Máy chủ lưu trữ và giấy phép cho nhóm. OpenBot miễn phí khi dùng cá nhân trên máy tính của bạn.",
  "sitePage.pricing.imageAlt": "Small team. Bright ideas. Ba trợ lý OpenBot dưới một vòm kính",
  "sitePage.pricing.heading": "Bảng giá",
  // The first block of the pricing page, above the order form.
  "sitePage.pricing.personal.title": "Dùng cá nhân miễn phí",
  "sitePage.pricing.personal.body":
    "Mọi tính năng, trên máy tính của bạn, với các gói AI bạn đang trả tiền. Không cần máy chủ, không cần giấy phép.",
  "sitePage.pricing.enterprise.title": "Doanh nghiệp",
  // {count} is the largest number of members that the page sells, such as 25.
  "sitePage.pricing.enterprise.body":
    "Máy chủ lớn hơn, hơn {count} thành viên, hoặc bất kỳ điều gì bạn cần. Kèm hỗ trợ doanh nghiệp.",
  "sitePage.pricing.enterprise.contact": "Liên hệ bộ phận bán hàng",
  // The /teams page for companies.
  "sitePage.teams.title": "OpenBot cho nhóm",
  "sitePage.teams.description":
    "Chạy OpenBot trên hạ tầng được quản lý, hoặc để chúng tôi thiết kế bản triển khai riêng theo nhóm, quy trình và hệ thống sẵn có của bạn.",
  // The text of the social image is English. Keep it as it is.
  "sitePage.teams.imageAlt": "Big plans. Better together. Hai trợ lý OpenBot nối với nhau bằng một cây cầu bằng giấy",
  // {team} is a row of agent avatars. The word before {team} stays on one line with the avatars.
  "sitePage.teams.hero.heading": "Đưa một đội {team} đồng nghiệp AI vào công ty của bạn",
  "sitePage.teams.setups.heading": "Chọn cách thiết lập phù hợp với nhóm của bạn",
  "sitePage.teams.setups.question": "Chưa chắc bạn cần cách thiết lập nào?",
  "sitePage.teams.setups.action": "Nói chuyện với chúng tôi",
  "sitePage.teams.setups.local.label": "Cục bộ",
  "sitePage.teams.setups.local.title": "Chạy cục bộ",
  "sitePage.teams.setups.local.description":
    "Phù hợp nhất cho người dùng cá nhân muốn chạy OpenBot trực tiếp trên hạ tầng của riêng mình.",
  "sitePage.teams.setups.managed.label": "Máy chủ được quản lý",
  "sitePage.teams.setups.managed.title": "Dùng máy chủ được quản lý",
  "sitePage.teams.setups.managed.description":
    "Giữ cho OpenBot luôn sẵn sàng mà không phụ thuộc vào một máy tính cá nhân. Chúng tôi cung cấp và duy trì máy chủ, để bạn tập trung vào trợ lý và quy trình của mình.",
  "sitePage.teams.setups.custom.label": "Bản triển khai riêng",
  "sitePage.teams.setups.custom.title": "Xây dựng cách thiết lập cho toàn công ty",
  "sitePage.teams.setups.custom.description":
    "Chúng tôi giúp cấu hình môi trường, trợ lý, quyền và tích hợp theo đúng cách tổ chức của bạn đang vận hành.",
  "sitePage.teams.benefits.alwaysOn.title": "Trợ lý của bạn hoạt động 24/7",
  "sitePage.teams.benefits.alwaysOn.description":
    "Chạy OpenBot trên hạ tầng được quản lý và cho nhóm của bạn một môi trường dùng chung, nơi con người, trợ lý và tự động hóa làm việc cùng nhau.",
  "sitePage.teams.benefits.automations.title": "Tự động hóa không bao giờ dừng",
  "sitePage.teams.benefits.automations.description":
    "Chạy nhiệm vụ định kỳ theo lịch và quy trình lặp lại 24/7 – kể cả ban đêm, cuối tuần hoặc khi nhóm của bạn không trực tuyến.",
  "sitePage.teams.benefits.multiplayer.title": "Cộng tác nhiều người",
  "sitePage.teams.benefits.multiplayer.description":
    "Đưa con người và đồng nghiệp AI vào cùng một máy chủ dùng chung. Thành viên trong nhóm có thể làm việc cùng trợ lý, phối hợp nhiệm vụ và cộng tác trong cùng một môi trường.",
  "sitePage.teams.benefits.anywhere.title": "Truy cập từ mọi nơi",
  "sitePage.teams.benefits.anywhere.description":
    "Kết nối từ xa tới môi trường OpenBot của bạn và tiếp tục làm việc trên các thiết bị máy tính hoặc di động được hỗ trợ.",
  "sitePage.teams.custom.heading": "OpenBot, được điều chỉnh cho doanh nghiệp của bạn",
  "sitePage.teams.custom.intro":
    "Có một máy chủ chỉ là bước đầu. Nếu công ty bạn cần một giải pháp hoàn chỉnh, chúng tôi có thể giúp thiết kế và triển khai OpenBot theo đúng quy trình thực tế của bạn.",
  // The five steps of a custom project, in order.
  "sitePage.teams.custom.infrastructure": "Thiết lập và cấu hình hạ tầng",
  "sitePage.teams.custom.agents": "Cấu hình trợ lý ban đầu",
  "sitePage.teams.custom.integrations": "Tích hợp với công cụ và hệ thống nội bộ hiện có",
  "sitePage.teams.custom.features": "Tính năng và quy trình riêng",
  "sitePage.teams.custom.support": "Bảo trì liên tục và hỗ trợ phát triển",
  "sitePage.teams.audience.heading": "Dành cho nhóm sẵn sàng khai thác toàn bộ tiềm năng của AI",
  // The page shows the first word of each audience item in bold.
  "sitePage.teams.audience.companies": "Các công ty đưa trợ lý AI vào nhiều bộ phận khác nhau.",
  "sitePage.teams.audience.agencies": "Các công ty tư vấn triển khai môi trường trợ lý cho khách hàng.",
  "sitePage.teams.audience.allDay": "Các nhóm cần trợ lý luôn sẵn sàng mọi lúc.",
  "sitePage.teams.audience.integrations": "Các tổ chức cần tích hợp với công cụ nội bộ.",
  "sitePage.teams.audience.support": "Các doanh nghiệp muốn được hỗ trợ triển khai thay vì tự xây dựng mọi thứ.",
  // {accent} is the accent key. The page shows its words in colour.
  "sitePage.teams.closing.heading": "Hãy cho chúng tôi biết bạn muốn {accent} đạt được điều gì",
  "sitePage.teams.closing.accent": "đồng nghiệp AI",
  "sitePage.teams.closing.action": "Trao đổi về cách thiết lập của bạn",
  // The /contact page and its form.
  "sitePage.contact.title": "Liên hệ với nhóm OpenBot",
  "sitePage.contact.description":
    "Gửi tin nhắn cho nhóm OpenBot về cách thiết lập riêng, quan hệ hợp tác hoặc báo chí. Mỗi tin nhắn đều được một con người đọc.",
  // The text of the social image is English. Keep it as it is.
  "sitePage.contact.imageAlt": "Small team. Always on it. Các trợ lý OpenBot quanh một hành tinh bằng giấy",
  "sitePage.contact.heading": "Nói chuyện với nhóm",
  "sitePage.contact.intro": "Hãy cho chúng tôi biết bạn cần gì. Mỗi tin nhắn đều được một thành viên nhóm OpenBot đọc.",
  // The other ways to reach the team. Discord, GitHub and X are names.
  "sitePage.contact.channel.discord": "Cộng đồng và trợ giúp",
  "sitePage.contact.channel.github": "Lỗi và mã nguồn",
  "sitePage.contact.channel.x": "Tin tức",
  "sitePage.contact.name": "Tên",
  "sitePage.contact.email": "Email",
  "sitePage.contact.company": "Công ty",
  "sitePage.contact.topic": "Chủ đề",
  "sitePage.contact.message": "Tin nhắn",
  // Shows beside the label of a field that the visitor can leave empty.
  "sitePage.contact.optional": "Tùy chọn",
  "sitePage.contact.placeholder": "Chúng tôi có thể giúp gì?",
  "sitePage.contact.emailInvalid": "Nhập một địa chỉ email hợp lệ",
  "sitePage.contact.messageEmpty": "Hãy viết tin nhắn",
  "sitePage.contact.topic.setup": "Thiết lập riêng",
  "sitePage.contact.topic.partnership": "Hợp tác",
  "sitePage.contact.topic.press": "Báo chí",
  "sitePage.contact.topic.other": "Nội dung khác",
  "sitePage.contact.send": "Gửi tin nhắn",
  "sitePage.contact.sending": "Đang gửi…",
  "sitePage.contact.privacy": "Chúng tôi chỉ dùng email của bạn để trả lời bạn.",
  // A link to the privacy policy, after the privacy key.
  "sitePage.contact.privacyLink": "Quyền riêng tư",
  // {email} is the team's email address, as a link.
  "sitePage.contact.limited": "Quá nhiều tin nhắn. Hãy thử lại sau, hoặc gửi email đến {email}.",
  // {email} is the team's email address, as a link.
  "sitePage.contact.failed": "Không thể gửi. Hãy thử lại, hoặc gửi email đến {email}.",
  "sitePage.contact.sentTitle": "Đã gửi tin nhắn",
  // {email} is the address that the visitor entered.
  "sitePage.contact.sentBody": "Chúng tôi sẽ trả lời tại {email}.",
  "sitePage.contact.sendAnother": "Gửi tin nhắn khác",
  // The public Marketplace on openbot.run. The tab and category names are the app's `marketplace.*` keys.
  "sitePage.marketplace.agents.title": "Trợ lý — Cửa hàng OpenBot",
  "sitePage.marketplace.agents.description":
    "Những trợ lý do người dùng tạo trong OpenBot. Thêm một trợ lý vào OpenBot kèm kỹ năng và nhiệm vụ định kỳ của nó.",
  "sitePage.marketplace.skills.title": "Kỹ năng — Cửa hàng OpenBot",
  "sitePage.marketplace.skills.description":
    "Những kỹ năng mà một trợ lý OpenBot có thể dùng. Thêm một kỹ năng vào OpenBot.",
  "sitePage.marketplace.apps.title": "Ứng dụng — Cửa hàng OpenBot",
  "sitePage.marketplace.apps.description":
    "Những ứng dụng và công cụ mà một trợ lý OpenBot có thể dùng. Mở một ứng dụng trong OpenBot, rồi quyết định ở đó nó kết nối với gì.",
  // {name} is the name of an agent or a skill.
  "sitePage.marketplace.agentTitle": "{name} — trợ lý OpenBot",
  "sitePage.marketplace.skillTitle": "{name} — kỹ năng OpenBot",
  // The text of the share image for screen readers. {creator} is the name of the person who made it.
  "sitePage.marketplace.agentImageAlt": "{name}, trợ lý OpenBot do {creator} tạo",
  "sitePage.marketplace.skillImageAlt": "{name}, kỹ năng OpenBot do {creator} tạo",
  "sitePage.marketplace.categories": "Danh mục",
  "sitePage.marketplace.allCategories": "Tất cả",
  "sitePage.marketplace.searchAgents": "Tìm trợ lý",
  "sitePage.marketplace.searchSkills": "Tìm kỹ năng",
  "sitePage.marketplace.searchApps": "Tìm ứng dụng",
  "sitePage.marketplace.featured": "Nổi bật",
  "sitePage.marketplace.results": "Kết quả",
  "sitePage.marketplace.seeAll": "Xem tất cả",
  "sitePage.marketplace.add": "Thêm",
  // {name} is the name of the person who made the agent or the skill.
  "sitePage.marketplace.by": "bởi {name}",
  // A screen reader reads this after the name of a verified agent or skill.
  "sitePage.marketplace.verifiedName": ", đã được OpenBot xác minh",
  // A screen reader reads this when a search or a category changes the list.
  "sitePage.marketplace.shownAgents": "Số trợ lý hiển thị: {shown} trong {total}",
  "sitePage.marketplace.shownSkills": "Số kỹ năng hiển thị: {shown} trong {total}",
  "sitePage.marketplace.shownApps": "Số ứng dụng hiển thị: {shown} trong {total}",
  "sitePage.marketplace.emptyAgentsCategory": "Chưa có trợ lý nào trong danh mục này.",
  "sitePage.marketplace.emptySkillsCategory": "Chưa có kỹ năng nào trong danh mục này.",
  // {query} is the text in the search field.
  "sitePage.marketplace.emptyAgentsQuery": "Không có trợ lý nào khớp với “{query}”.",
  "sitePage.marketplace.emptySkillsQuery": "Không có kỹ năng nào khớp với “{query}”.",
  "sitePage.marketplace.emptyApps": "Không có ứng dụng nào khớp.",
  "sitePage.marketplace.breadcrumb": "Đường dẫn điều hướng",
  "sitePage.marketplace.addToOpenBot": "Thêm vào OpenBot",
  // Shows after "Add to OpenBot" did not open the app.
  "sitePage.marketplace.addFromApp":
    "{name} được thêm từ bên trong OpenBot. Hãy tải ứng dụng, rồi mở lại liên kết này.",
  // {platform} is macOS, Windows or Linux.
  "sitePage.marketplace.downloadFor": "Tải cho {platform}",
  "sitePage.marketplace.copyLink": "Sao chép liên kết",
  "sitePage.marketplace.copied": "Đã sao chép",
  "sitePage.marketplace.trust.agentReviewed":
    "Được một người dùng OpenBot khác tạo. OpenBot đã kiểm tra trước khi nó được đưa lên. Sau khi thêm, nó có thể hành động thay bạn.",
  "sitePage.marketplace.trust.agentPending":
    "Được người tạo chia sẻ trước khi OpenBot kiểm tra. Sau khi thêm, nó có thể hành động thay bạn.",
  "sitePage.marketplace.trust.skillReviewed":
    "Được một người dùng OpenBot khác tạo. OpenBot đã kiểm tra trước khi nó được đưa lên.",
  "sitePage.marketplace.source.verified": "Đã được OpenBot xác minh",
  "sitePage.marketplace.source.reviewed": "Đã được OpenBot kiểm duyệt",
  "sitePage.marketplace.source.pending": "Chưa được kiểm duyệt",
  "sitePage.marketplace.information": "Thông tin",
  "sitePage.marketplace.fact.creator": "Người tạo",
  "sitePage.marketplace.fact.source": "Nguồn",
  "sitePage.marketplace.fact.category": "Danh mục",
  "sitePage.marketplace.fact.version": "Phiên bản",
  "sitePage.marketplace.fact.updated": "Đã cập nhật",
  // {version} is a number, such as 3.
  "sitePage.marketplace.skillVersion": "Phiên bản {version}",
  // A routine that the agent brings switched off. It runs only after the user switches it on.
  "sitePage.marketplace.routineOff": "Bắt đầu ở trạng thái tắt",
  "sitePage.marketplace.missing.title": "Không có trong Cửa hàng",
  "sitePage.marketplace.missing.body": "Người tạo đã xóa nó, OpenBot không phê duyệt, hoặc liên kết sai.",
  "sitePage.marketplace.missing.open": "Mở Cửa hàng",
  // The home page. The title and the description are also the text of a search result and a link preview.
  "sitePage.landing.title": "OpenBot: Chạy một đội trợ lý AI trên máy tính của bạn",
  "sitePage.landing.description":
    "Ứng dụng máy tính miễn phí chạy các trợ lý AI như một đội trên máy tính của bạn, với gói ChatGPT, Claude, Gemini hoặc Grok bạn đang trả tiền, hoặc mô hình của riêng bạn.",
  // A badge before "Available on". Keep it short and in capitals.
  "sitePage.landing.hero.new": "MỚI",
  // Platform logos and names follow: macOS, Windows, Linux, iOS, Android.
  "sitePage.landing.hero.availableOn": "Có trên",
  // The page heading. {name} is the OpenBot logo and the name OpenBot.
  "sitePage.landing.hero.title": "Gặp {name}",
  // {codex}, {claude}, {gemini} and {grok} are provider names with their logos.
  "sitePage.landing.hero.description":
    "Chạy {codex}, {claude}, {gemini}, {grok} và mô hình của riêng bạn trong một không gian làm việc xuyên suốt. Các trợ lý chuyển giao việc, dùng công cụ và cộng tác cùng đồng đội thật của bạn. Miễn phí khi dùng cá nhân.",
  "sitePage.landing.hero.contact": "Liên hệ",
  "sitePage.landing.hero.choosePlatform": "Chọn nền tảng tải xuống",
  "sitePage.landing.hero.platforms": "Nền tảng tải xuống",
  "sitePage.landing.hero.phoneApps": "Ứng dụng điện thoại",
  "sitePage.landing.preview.title": "Xem trước ứng dụng OpenBot tương tác",
  "sitePage.landing.preview.loading": "Đang tải bản xem trước của OpenBot",
  // The words of this heading appear one at a time.
  "sitePage.landing.network.title": "Các trợ lý của bạn làm việc cùng nhau.",
  "sitePage.landing.network.description":
    "Mỗi trợ lý có vai trò, chỉ dẫn và không gian làm việc riêng. Chúng gửi tin nhắn cho nhau, chuyển giao nhiệm vụ, chia sẻ tệp và kiểm tra kết quả.",
  // Easter eggs: short lines that the agents in the picture say. Each reaction chooses one line at
  // random. One line on each row; the number of rows can change.
  // The visitor types "hello".
  "sitePage.landing.network.eggs.greetings":
    "Chào!\nXin chào.\nÊ, có mặt rồi.\nỒ, chào.\nRất vui gặp bạn.\nChào con người.\nChào mừng trở lại.",
  // The visitor types the Konami code.
  "sitePage.landing.network.eggs.konami": "Đã chấp nhận mã gian lận.\nThêm ba mươi trợ lý.\nĐã mở khóa thành tích.",
  // The visitor types "party".
  "sitePage.landing.network.eggs.party": "Chế độ tiệc.\nAi mang pháo giấy đến?\nNghỉ nhảy múa.",
  // The visitor types "sudo".
  "sitePage.landing.network.eggs.sudo": "Sự cố này sẽ được báo cáo.\nCố gắng thật.\nBạn không có trong tệp sudoers.",
  // The centre of the picture after 3, 5 and 8 quick clicks.
  "sitePage.landing.network.eggs.tickle": "Cái đó nhột.\nÊ.\nTôi cảm nhận được rồi.",
  "sitePage.landing.network.eggs.awake":
    "Được rồi, được rồi. Tôi đã thức.\nVâng? Tôi có thể giúp gì?\nTôi đang lắng nghe.",
  "sitePage.landing.network.eggs.busy": "Xin đừng. Tôi đang định tuyến tin nhắn.\nTôi có việc phải làm.\nDừng lại đi.",
  // The agents answer the centre after 5 clicks.
  "sitePage.landing.network.eggs.wonder": "Cái gì vừa xảy ra?\nBạn có cảm nhận được không?\nTrung tâm có ổn không?",
  // After 12 clicks the centre sneezes, and the agents answer.
  "sitePage.landing.network.eggs.sneeze": "Hắt!\nÁ… xì!",
  "sitePage.landing.network.eggs.blessings": "Chúc bạn sức khỏe.\nGesundheit.\nSalud.\nChúc bạn sức khỏe!",
  // The agents wake up after the visitor leaves the page alone.
  "sitePage.landing.network.eggs.wake":
    "Tôi không ngủ.\nChỉ nghỉ ngơi token thôi.\nQuay lại làm việc.\nAi tắt đèn?\nCòn năm phút nữa.",
  // Agents answer a click.
  "sitePage.landing.network.eggs.chats":
    "Để tôi lo.\nNhận rồi. Bắt đầu ngay.\nKiểm thử của tôi đã đạt.\nTôi có thể nhận phần review.\nTôi đã đẩy bản sửa.\nAi đang giữ việc Safari?\nXong. Chuyển sang bạn.\nTôi cần thêm một tệp.\nĐã merge.\nBản build đang xanh.\nTôi tìm ra lỗi rồi.\nAi review nhánh của tôi được không?\nHãy ship đi.\nCho tôi năm phút.\nTôi đã viết ghi chú phát hành.",
  // An agent under a pointer that does not move.
  "sitePage.landing.network.eggs.hover":
    "Tôi chỉ trông bận thôi.\nHỏi tôi về việc Safari nhé.\nTôi đã đọc cả kho mã. Hai lần.\nCửa sổ ngữ cảnh của tôi vẫn còn chỗ cho bạn.\nXin đừng đóng tab này.\nTôi sửa một lỗi và tìm ra ba lỗi.\nTôi chạy trên máy tính của bạn, không phải trên đám mây.",
  "sitePage.landing.features.title": "OpenBot làm được gì",
  "sitePage.landing.features.description":
    "Một ứng dụng cho một đội trợ lý AI làm việc trên máy chủ hoặc máy tính của bạn. Chạy trên gói đăng ký bạn đã có.",
  "sitePage.landing.features.team.title": "Các trợ lý làm việc như một đội",
  "sitePage.landing.features.team.description":
    "Mỗi trợ lý có tên, chỉ dẫn và không gian làm việc riêng. Các trợ lý gửi tin nhắn cho nhau, chuyển giao nhiệm vụ và chia sẻ tệp.",
  "sitePage.landing.features.providers.title": "Dùng gói AI bạn đang có",
  // Each placeholder is a link to a provider page. {acp} is acpLink, {local} is localLink, the others
  // are product names.
  "sitePage.landing.features.providers.description":
    "Chạy {codex}, {claudeCode}, {gemini}, {grok}, {opencode}, {cursor}, {cline}, {museCode}, {pi} hoặc {mercury}. Hoặc thêm {acp}, một điểm cuối tương thích OpenAI, {local}.",
  "sitePage.landing.features.providers.acpLink": "một trợ lý ACP",
  "sitePage.landing.features.providers.localLink": "Ollama hoặc LM Studio",
  "sitePage.landing.features.local.title": "Được lưu trên máy tính của bạn",
  "sitePage.landing.features.local.description":
    "Không gian làm việc, cuộc hội thoại, tệp và dữ liệu trình duyệt vẫn ở trên máy tính chạy OpenBot, không phải trên máy chủ của chúng tôi.",
  "sitePage.landing.features.multiplayer.title": "Chế độ nhiều người",
  "sitePage.landing.features.multiplayer.description":
    "Mời đồng đội của bạn vào OpenBot. Con người và trợ lý AI cộng tác trong các kênh dùng chung và làm việc trên cùng dự án.",
  "sitePage.landing.features.workflows.title": "Quy trình",
  "sitePage.landing.features.workflows.description":
    "Kết hợp trợ lý, mô hình và các bước phê duyệt thành quy trình nhiều bước rõ ràng. Tái sử dụng quy trình và cập nhật khi công việc của bạn thay đổi.",
  "sitePage.landing.features.persist.title": "Đổi nhà cung cấp, giữ nguyên trợ lý",
  "sitePage.landing.features.persist.description":
    "Một trợ lý giữ nguyên không gian làm việc và cuộc hội thoại khi bạn khởi động lại ứng dụng hoặc chuyển sang nhà cung cấp khác. Khi một gói đạt giới hạn, nó có thể chuyển sang một mô hình dự phòng.",
  // The pictures on the feature tiles copy the app. Ada, Linus and Grace are agent names.
  // A channel name, shown after "#". Lower case, no spaces.
  "sitePage.landing.picture.channel": "launch",
  "sitePage.landing.picture.team.first": "Bài kiểm tra đăng nhập lỗi trên Safari. Linus, bạn nhận việc này được không?",
  "sitePage.landing.picture.team.second": "Đã sửa trong session.ts. Grace, bạn review giúp được không?",
  "sitePage.landing.picture.team.third": "Trông ổn rồi. Tôi đã merge.",
  "sitePage.landing.picture.team.reply": "Cảm ơn. Tôi đã đóng issue.",
  // {from} and {to} are agent names.
  "sitePage.landing.picture.team.handoff": "{from} đã chuyển nhiệm vụ cho {to}",
  "sitePage.landing.picture.persist.earlier": "Tôi đã đọc mã thanh toán. Sáu bảng dùng nó.",
  "sitePage.landing.picture.persist.request": "Chuyển các bảng thanh toán sang schema riêng.",
  "sitePage.landing.picture.persist.before": "Xong. Tôi đã sửa 4 tệp và viết migration.",
  // {agent} is an agent name. {provider} is a provider name.
  "sitePage.landing.picture.persist.switch": "{agent} hiện dùng {provider}",
  "sitePage.landing.picture.persist.after": "Tôi tiếp tục từ migration thanh toán. Tiếp theo là bài kiểm tra của nó.",
  "sitePage.landing.picture.local.title": "Trên máy tính này",
  "sitePage.landing.picture.local.workspaces": "Không gian làm việc",
  "sitePage.landing.picture.local.conversations": "Cuộc hội thoại",
  "sitePage.landing.picture.local.files": "Tệp",
  "sitePage.landing.picture.local.browserData": "Dữ liệu trình duyệt",
  // Maya and Sam are people. Ada is an agent.
  "sitePage.landing.picture.multiplayer.first": "Ada, bạn viết thử bài đăng ra mắt được không?",
  "sitePage.landing.picture.multiplayer.second": "Xong rồi. Sam, bạn kiểm tra giúp được không?",
  "sitePage.landing.picture.multiplayer.third": "Trông ổn rồi. Tôi đã đăng.",
  // The button that adds a person to the channel.
  "sitePage.landing.picture.multiplayer.invite": "Mời",
  // The steps of a workflow, as on the workflow canvas of the app.
  "sitePage.landing.picture.workflows.trigger": "Kích hoạt",
  "sitePage.landing.picture.workflows.schedule": "Mỗi thứ Hai lúc 9:00",
  // Four agent steps. The first two run at the same time, then the next two use their results.
  "sitePage.landing.picture.workflows.issues": "Tóm tắt các issue tuần trước",
  "sitePage.landing.picture.workflows.usage": "Thu thập số liệu mức dùng",
  "sitePage.landing.picture.workflows.report": "Viết báo cáo hằng tuần",
  "sitePage.landing.picture.workflows.charts": "Vẽ biểu đồ từ số liệu",
  "sitePage.landing.picture.workflows.approval": "Phê duyệt",
  "sitePage.landing.picture.workflows.question": "Đăng báo cáo?",
  "sitePage.landing.picture.workflows.approve": "Phê duyệt",
  "sitePage.landing.picture.workflows.approved": "Đã phê duyệt",
  "sitePage.landing.pricing.title": "Miễn phí khi dùng cá nhân",
  "sitePage.landing.pricing.everyFeature": "Mọi tính năng",
  "sitePage.landing.pricing.yourComputer": "Chạy trên máy tính của bạn",
  "sitePage.landing.pricing.yourPlans": "Dùng các gói AI bạn đang trả tiền",
  "sitePage.landing.pricing.download": "Tải xuống",
  "sitePage.landing.pricing.license": "Giấy phép dùng cho công việc",
  "sitePage.landing.teams.title": "OpenBot cho nhóm",
  "sitePage.landing.teams.statement": "Đồng nghiệp AI cho cả công ty bạn.",
  "sitePage.landing.teams.description":
    "Chúng tôi chạy OpenBot trên máy chủ được quản lý và thiết lập theo nhóm và công cụ của bạn.",
  "sitePage.landing.teams.contact": "Liên hệ với chúng tôi",
  "sitePage.landing.teams.learn": "Tìm hiểu về OpenBot cho nhóm",
  "sitePage.landing.teams.servers.label": "Máy chủ được quản lý",
  "sitePage.landing.teams.servers.title": "Luôn hoạt động",
  "sitePage.landing.teams.servers.description":
    "Các trợ lý chạy trên máy chủ được quản lý, không phải trên máy tính xách tay của ai đó.",
  "sitePage.landing.teams.environments.label": "Môi trường nhóm",
  "sitePage.landing.teams.environments.title": "Dùng chung hoặc riêng tư",
  "sitePage.landing.teams.environments.description": "Một máy chủ cho công ty, mỗi nhân viên một máy chủ, hoặc cả hai.",
  "sitePage.landing.teams.integrations.label": "Tích hợp riêng",
  "sitePage.landing.teams.integrations.title": "Công cụ của bạn",
  "sitePage.landing.teams.integrations.description":
    "Chúng tôi kết nối OpenBot với hệ thống, API và quy trình của bạn.",
  "sitePage.landing.teams.support.label": "Triển khai và hỗ trợ",
  "sitePage.landing.teams.support.title": "Chúng tôi ra mắt cùng bạn",
  "sitePage.landing.teams.support.description": "Thiết lập, kiểm thử, đào tạo và hỗ trợ liên tục.",
  "sitePage.landing.faq.title": "Câu hỏi",
  "sitePage.landing.faq.description": "Câu trả lời ngắn về giá, thiết lập, nhà cung cấp và dữ liệu của bạn.",
  "sitePage.landing.faq.contact": "Hỏi chúng tôi câu khác",
  "sitePage.landing.faq.free.question": "OpenBot có miễn phí không?",
  "sitePage.landing.faq.free.answer":
    "Có, cho sử dụng cá nhân và các mục đích phi thương mại khác. OpenBot có giá $0, không khóa tính năng nào. Bạn chỉ trả cho nhà cung cấp AI của mình, qua gói hoặc khóa API bạn đã có. Sử dụng thương mại cần giấy phép.",
  "sitePage.landing.faq.source.question": "Mã nguồn của OpenBot có mở không?",
  "sitePage.landing.faq.source.answer":
    "Có. Toàn bộ mã nguồn được mở trên GitHub, nên bạn có thể kiểm tra OpenBot làm gì. Bạn có thể sửa và chạy miễn phí cho mục đích phi thương mại, như dự án cá nhân, học tập hoặc nghiên cứu. Sử dụng thương mại cần một giấy phép riêng. Giấy phép là PolyForm Noncommercial 1.0.0.",
  "sitePage.landing.faq.source.link": "Xem mã nguồn trên GitHub",
  "sitePage.landing.faq.plans.question": "Tôi có thể dùng gói ChatGPT hoặc Claude của mình không?",
  "sitePage.landing.faq.plans.answer":
    "Có. Codex đăng nhập bằng gói ChatGPT của bạn, còn Claude Code bằng gói Claude của bạn. Gemini dùng gói Google AI Pro hoặc Ultra. OpenCode có các mô hình miễn phí không cần tài khoản.",
  "sitePage.landing.faq.models.question": "OpenBot dùng được những mô hình AI nào?",
  "sitePage.landing.faq.models.answer":
    "Codex, Claude Code, Gemini, Grok, OpenCode, Cursor, Cline, Muse Code và Pi, cùng các mô hình Mercury của Inception. Bạn cũng có thể chạy bất kỳ trợ lý nào nói theo Agent Client Protocol, như Goose hoặc Qwen Code, kết nối mọi điểm cuối tương thích OpenAI, và dùng mô hình cục bộ trong Ollama hoặc LM Studio.",
  "sitePage.landing.faq.limit.question": "Điều gì xảy ra khi gói của tôi đạt giới hạn?",
  "sitePage.landing.faq.limit.answer":
    "Một trợ lý có thể chuyển sang mô hình dự phòng ở nhà cung cấp khác khi gói của nó đạt giới hạn, hoặc khi nhà cung cấp quá tải hay bị gián đoạn. Nó giữ nguyên cuộc trò chuyện và không gian làm việc, và một ghi chú trong cuộc trò chuyện cho biết việc chuyển đổi.",
  "sitePage.landing.faq.start.question": "Tôi bắt đầu thế nào?",
  "sitePage.landing.faq.start.answer":
    "Tải OpenBot và kết nối một nhà cung cấp. Sau đó mô tả trợ lý bạn muốn trong một câu lệnh, kiểm tra chỉ dẫn và lưu lại. Bạn có thể gửi việc cho nó ngay: các tin nhắn nằm trong hàng đợi cho đến khi nó rảnh.",
  "sitePage.landing.faq.data.question": "Dữ liệu của tôi đi đâu?",
  "sitePage.landing.faq.data.answer":
    "Không gian làm việc, cuộc hội thoại, tệp đính kèm và dữ liệu trình duyệt vẫn ở trên máy tính chạy OpenBot. Nhà cung cấp AI bạn chọn nhận các câu lệnh mà trợ lý của bạn gửi đến, và các trang mà trợ lý mở dùng mạng.",
  "sitePage.landing.faq.computers.question": "Máy tính nào có thể chạy OpenBot?",
  "sitePage.landing.faq.computers.answer":
    "macOS 13 trở lên trên Apple silicon hoặc Intel, Windows 10 trở lên trên x64, và Linux trên x64 hoặc arm64 dưới dạng AppImage.",
  "sitePage.landing.faq.safety.question": "Cho trợ lý làm việc trên máy tính của tôi có an toàn không?",
  "sitePage.landing.faq.safety.answer":
    "Trợ lý có thể đọc và thay đổi tệp, chạy lệnh, dùng mạng và điều khiển trình duyệt tích hợp mà không cần hỏi lại mỗi lần. Chỉ giao cho chúng những việc bạn tin tưởng, và hãy sao lưu.",
  "sitePage.landing.faq.compare": "So sánh OpenBot",
  "sitePage.landing.download.title": "Tải OpenBot",
  "sitePage.landing.download.description":
    "Chọn nền tảng của bạn. Chạy Codex, Claude, Gemini, Grok, OpenCode, Muse Code, Pi hoặc mô hình của riêng bạn từ một ứng dụng máy tính, và trò chuyện với trợ lý ngay trên điện thoại.",
  // The badge on a download card.
  "sitePage.landing.download.available": "Sẵn có",
  // {store} is App Store or Google Play.
  "sitePage.landing.download.phoneDescription": "{store} · Kết nối với máy tính của bạn",
  "sitePage.landing.download.appStore": "Tải trên App Store",
  "sitePage.landing.download.googlePlay": "Tải trên Google Play",
  // Links to the install page of each platform follow.
  "sitePage.landing.download.pages": "Yêu cầu hệ thống và các bước cài đặt:",
  // The header, the menu, the footer and the last call to action of the public site.
  "sitePage.site.download": "Tải xuống",
  "sitePage.site.app": "Ứng dụng",
  "sitePage.site.primaryNavigation": "Điều hướng chính",
  "sitePage.site.siteMenu": "Menu trang web",
  "sitePage.site.openMenu": "Mở menu",
  "sitePage.site.closeMenu": "Đóng menu",
  // The label of the list of the languages of the site.
  "sitePage.site.language": "Ngôn ngữ",
  // The header button that opens the list of languages. {language} is the name of the page language in that language.
  "sitePage.site.language.current": "Ngôn ngữ: {language}",
  // A badge on the newest article in the menu.
  "sitePage.site.latest": "Mới nhất",
  "sitePage.site.home": "Trang chủ OpenBot",
  "sitePage.site.logo.menu": "Logo",
  "sitePage.site.logo.copyIcon": "Sao chép logo dạng SVG",
  "sitePage.site.logo.copyLockup": "Sao chép logo kèm tên dạng SVG",
  "sitePage.site.logo.downloadAssets": "Tải tài nguyên thương hiệu",
  "sitePage.site.logo.openBrand": "Mở trang thương hiệu",
  "sitePage.site.news": "Tin tức",
  "sitePage.site.news.summary": "Những gì đã ra mắt, và vì sao nó quan trọng.",
  "sitePage.site.news.index": "Tất cả tin tức",
  "sitePage.site.guides": "Hướng dẫn",
  "sitePage.site.guides.summary": "Học OpenBot từng bước một.",
  "sitePage.site.guides.index": "Tất cả hướng dẫn",
  "sitePage.site.compare": "So sánh",
  "sitePage.site.compare.summary": "OpenBot khác gì so với các ứng dụng trợ lý khác.",
  "sitePage.site.compare.index": "Tất cả bài so sánh",
  "sitePage.site.plugins": "Tiện ích",
  "sitePage.site.plugins.summary": "Ứng dụng và kỹ năng mà một trợ lý có thể dùng.",
  "sitePage.site.plugins.index": "Duyệt tiện ích",
  "sitePage.site.resources": "Tài nguyên",
  "sitePage.site.resources.summary": "Mã nguồn của OpenBot được mở.",
  "sitePage.site.sourceCode": "Mã nguồn",
  "sitePage.site.download.description": "macOS, Windows và Linux",
  "sitePage.site.changelog": "Nhật ký thay đổi",
  "sitePage.site.changelog.description": "Thay đổi trong từng phiên bản",
  "sitePage.site.community": "Cộng đồng",
  "sitePage.site.community.description": "Trò chuyện với chúng tôi trên Discord",
  "sitePage.site.documentation": "Tài liệu",
  "sitePage.site.documentation.description": "Thiết lập và sử dụng OpenBot",
  "sitePage.site.brand": "Thương hiệu",
  "sitePage.site.brand.description": "Logo dạng SVG và PNG",
  "sitePage.site.status": "Trạng thái",
  "sitePage.site.status.description": "Dịch vụ có đang hoạt động",
  "sitePage.site.forTeams": "Dành cho nhóm",
  "sitePage.site.pricing": "Bảng giá",
  "sitePage.site.cta.title": "Gặp đồng đội đầu tiên của bạn",
  "sitePage.site.cta.description":
    "Chạy Codex, Claude, Gemini, Grok hoặc mô hình của riêng bạn với các gói bạn đang trả tiền, mỗi mô hình có không gian làm việc và ngữ cảnh riêng. Công việc của bạn vẫn ở trên máy tính của bạn.",
  "sitePage.site.downloadOpenBot": "Tải OpenBot",
  "sitePage.site.contact": "Liên hệ",
  "sitePage.site.footer.description":
    "Đồng đội AI luôn theo bạn trên máy tính của bạn. Chạy Codex, Claude, Gemini, Grok, Muse Code, Pi hoặc mô hình của riêng bạn với các gói bạn đang trả tiền.",
  "sitePage.site.footer.navigation": "Điều hướng chân trang",
  "sitePage.site.footer.product": "Sản phẩm",
  "sitePage.site.footer.providers": "Nhà cung cấp",
  "sitePage.site.footer.marketplace": "Cửa hàng",
  "sitePage.site.footer.teams": "Nhóm",
  "sitePage.site.footer.license": "Giấy phép",
  "sitePage.site.footer.privacy": "Chính sách quyền riêng tư",
  "sitePage.site.footer.terms": "Điều khoản",
  "sitePage.site.footer.commercialLicense": "Giấy phép thương mại",
  "sitePage.site.footer.troubleshooting": "Khắc phục sự cố",
  "sitePage.site.footer.selfHosted": "Máy chủ tự quản lý",
  "sitePage.site.footer.architecture": "Kiến trúc",
  "sitePage.site.footer.contributing": "Đóng góp",
  "sitePage.site.footer.localModels": "Ollama và LM Studio",
  "sitePage.site.footer.allProviders": "Tất cả nhà cung cấp",
  "sitePage.site.footer.bestApps": "Ứng dụng trợ lý AI tốt nhất",
  // {year} is the current year. Synthetify Labs is a company name.
  "sitePage.site.footer.rights": "© {year} Synthetify Labs, Bảo lưu mọi quyền.",
  "sitePage.site.footer.available": "Có cho macOS, Windows, Linux, iOS và Android",
  // {love} is a heart icon. Its spoken name is the love key.
  "sitePage.site.footer.made": "Được làm với {love} tại Ba Lan",
  "sitePage.site.footer.love": "yêu thương",
} as const satisfies PartialTranslation<typeof source>;
