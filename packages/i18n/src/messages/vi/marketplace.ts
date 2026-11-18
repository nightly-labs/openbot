import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  // The listing: categories, rows, and the words for each kind of listing.
  "marketplace.category.coding": "Lập trình",
  "marketplace.category.design": "Thiết kế",
  "marketplace.category.dataAnalytics": "Dữ liệu & Phân tích",
  "marketplace.category.documents": "Tài liệu",
  "marketplace.category.productivity": "Năng suất",
  "marketplace.category.research": "Nghiên cứu",
  "marketplace.category.automation": "Tự động hóa",
  "marketplace.category.other": "Khác",
  "marketplace.loadFailed": "Không thể tải cửa hàng.",
  "marketplace.loading.skills": "Đang tải kỹ năng",
  "marketplace.loading.agents": "Đang tải trợ lý",
  "marketplace.noMatch.skills": "Không có kỹ năng nào khớp với tìm kiếm này.",
  "marketplace.noMatch.agents": "Không có trợ lý nào khớp với tìm kiếm này.",
  "marketplace.loadMore": "Tải thêm",
  "marketplace.version": "Phiên bản {version}",

  // The dialog frame: title, close and tabs.
  "marketplace.title": "Cửa hàng",
  "marketplace.kinds": "Loại nội dung cửa hàng",
  "marketplace.tab.agents": "Trợ lý",
  "marketplace.tab.skills": "Kỹ năng",
  "marketplace.description.apps": "Kết nối các công cụ và dịch vụ mà trợ lý của bạn dùng.",
  "marketplace.description.agents": "Trợ lý dựng sẵn với chỉ dẫn và kỹ năng riêng.",
  "marketplace.description.skills": "Chỉ dẫn dạy trợ lý một nhiệm vụ hoặc một công cụ.",

  // A plugin link.
  "marketplace.plugins.missing": "Tiện ích này không có trong danh mục OpenBot.",

  // The agent page.
  "marketplace.agents.loadingDetail": "Đang tải chi tiết trợ lý…",
  "marketplace.agents.skills": "Kỹ năng",
  "marketplace.agents.routines": "Nhiệm vụ định kỳ",
  "marketplace.agents.routineInactive": "Không hoạt động",
  "marketplace.agents.by": "bởi {name}",
  "marketplace.agents.routineCount": { other: "{count} nhiệm vụ định kỳ" },
  "marketplace.agents.yours": "Trợ lý của bạn",
  "marketplace.agents.all": "Tất cả trợ lý",
  "marketplace.agents.missing": "Trợ lý này không có trong Cửa hàng.",
  "marketplace.agents.trust.reviewed":
    "Do người dùng OpenBot khác tạo. OpenBot đã kiểm duyệt trước khi nó được đưa lên.",
  "marketplace.agents.trust.reviewedBeforeAdd":
    "Do người dùng OpenBot khác tạo. OpenBot đã kiểm duyệt trước khi nó được đưa lên. Sau khi thêm, nó có thể hành động thay bạn.",
  "marketplace.agents.trust.pending": "Do người tạo chia sẻ trước khi OpenBot kiểm duyệt.",
  "marketplace.agents.trust.pendingBeforeAdd":
    "Do người tạo chia sẻ trước khi OpenBot kiểm duyệt. Sau khi thêm, nó có thể hành động thay bạn.",
  "marketplace.agents.source.pending": "Chưa được kiểm duyệt",

  // The skill page, and why Try is off.
  "marketplace.skill.loading": "Đang tải kỹ năng",
  "marketplace.try.readFailed": "OpenBot không thể đọc kỹ năng của trợ lý này. Hãy thử lại.",
  "marketplace.try.enable": "Bật kỹ năng này trong cài đặt trợ lý để thử.",
  "marketplace.try.repair": "Sửa kỹ năng này trong cài đặt trợ lý để thử.",
  "marketplace.try.update": "Cập nhật kỹ năng này để thử phiên bản này.",
  "marketplace.try.composerUnavailable": "Trình soạn trợ lý không khả dụng.",

  // The Marketplace window. {name} is an agent, app or skill name. {count} is a number.
  "marketplace.open": "Mở {name}",
  "marketplace.tab.apps": "Ứng dụng",
  "marketplace.crumbs.label": "Vị trí",
  "marketplace.search.label": "Tìm kiếm trong cửa hàng",
  "marketplace.search.placeholder": "Tìm kiếm",
  "marketplace.installs": { other: "{installs} lượt cài đặt" },
  "marketplace.filter.clear": "Xóa bộ lọc",
  "marketplace.noMatch.apps": "Không có ứng dụng nào khớp với tìm kiếm này.",
  "marketplace.noMatch.filters": "Không có gì khớp với bộ lọc.",
  "marketplace.noMatch.showAgents": { other: "Hiện {count} trợ lý" },
  "marketplace.noMatch.showApps": { other: "Hiện {count} ứng dụng" },
  "marketplace.noMatch.showSkills": { other: "Hiện {count} kỹ năng" },
  "marketplace.empty.agents": "Chưa có trợ lý nào trong cửa hàng.",
  "marketplace.empty.apps": "Chưa có ứng dụng nào trong cửa hàng.",
  "marketplace.empty.skills": "Chưa có kỹ năng nào trong cửa hàng.",
  "marketplace.properties.creator": "Người tạo",
  "marketplace.properties.category": "Danh mục",
  "marketplace.properties.version": "Phiên bản",
  "marketplace.properties.updated": "Đã cập nhật",
  "marketplace.properties.installs": "Lượt cài đặt",

  // Agents.
  "marketplace.agent.add": "Thêm",
  "marketplace.agent.addNamed": "Thêm {name}",
  "marketplace.agent.addAgent": "Thêm trợ lý",
  "marketplace.agent.added": "Đã thêm",
  "marketplace.agent.updateAvailable": "Có bản cập nhật",
  "marketplace.agent.update": "Cập nhật",
  "marketplace.agent.openChat": "Mở trò chuyện",

  // The question before an agent update that meets skills with local changes.
  "marketplace.agentUpdate.title": "Cập nhật {name}?",
  "marketplace.agentUpdate.body": {
    other: "{count} kỹ năng có thay đổi cục bộ. Chúng được giữ nguyên trừ khi bạn chọn Thay thế.",
  },
  "marketplace.agentUpdate.listLabel": "Kỹ năng có thay đổi cục bộ",
  "marketplace.agentUpdate.keep": "Thay đổi của bạn được giữ",
  "marketplace.agentUpdate.lost": "Thay đổi của bạn sẽ bị mất",
  "marketplace.agentUpdate.choiceLabel": "Giữ hoặc thay thế {name}",
  "marketplace.agentUpdate.keepOption": "Giữ",
  "marketplace.agentUpdate.replace": "Thay thế",
  "marketplace.agentUpdate.others": {
    other: "{count} kỹ năng khác cũng được cập nhật.",
  },
  "marketplace.agentUpdate.confirm": "Cập nhật trợ lý",

  // Apps.
  "marketplace.app.connect": "Kết nối",
  "marketplace.app.reconnect": "Kết nối lại",
  "marketplace.app.connectNamed": "Kết nối {name}",
  "marketplace.app.reconnectNamed": "Kết nối lại {name}",
  "marketplace.app.connected": "Đã kết nối",
  "marketplace.app.attention": "Cần chú ý",
  // The plugin page alert when only some of its apps or skills are installed. {name} is the plugin name.
  "marketplace.app.partialTitle": "{name} chưa hoàn tất",
  "marketplace.app.partialDescription":
    "Một số ứng dụng hoặc kỹ năng của nó chưa được cài đặt. Kết nối lại sẽ cài đặt chúng.",
  "marketplace.app.notConnected": "Chưa kết nối",
  "marketplace.app.custom": "Máy chủ MCP",
  "marketplace.app.githubTagline": "Kho mã, vấn đề và pull request",
  "marketplace.app.onePasswordTagline": "Đăng nhập vào các trang bằng thông tin đăng nhập bạn chia sẻ",
  "marketplace.app.slackTagline": "Đề cập và tin nhắn trực tiếp trong Slack",
  "marketplace.app.discordTagline": "Đề cập và tin nhắn trực tiếp trong Discord",
  "marketplace.app.telegramTagline": "Nhóm và trò chuyện trực tiếp trong Telegram",
  "marketplace.app.whatsappTagline": "Trò chuyện của bạn và những người bạn cho phép trong WhatsApp",
  "marketplace.app.bitwardenTagline": "Đăng nhập vào các trang bằng thông tin đăng nhập từ một thư mục dùng chung",
  "marketplace.app.protonPassTagline": "Đăng nhập vào các trang bằng thông tin đăng nhập từ một kho dùng chung",
  // The category row in the information of a password manager page: 1Password, Bitwarden and Proton Pass.
  "marketplace.app.onePasswordCategory": "Quản lý thông tin đăng nhập và thông tin xác thực",
  "marketplace.app.yourApps": "Ứng dụng của bạn",
  "marketplace.app.addCustom": "Thêm tùy chỉnh",
  "marketplace.app.server": "Máy chủ",
  "marketplace.app.command": "Lệnh",
  "marketplace.app.address": "Địa chỉ",
  "marketplace.app.disconnect.title": "Ngắt kết nối {name}",
  "marketplace.app.disconnect.description":
    "Gỡ {name} và các kỹ năng của nó khỏi máy tính này. Bạn có thể kết nối lại sau.",
  "marketplace.app.disconnect.action": "Ngắt kết nối",
  "marketplace.app.remove.title": "Gỡ máy chủ",
  "marketplace.app.remove.description": "Trợ lý của bạn không thể dùng máy chủ này nữa. Cài đặt của nó bị xóa.",
  "marketplace.app.remove.action": "Gỡ bỏ",
  "marketplace.app.remove.confirmTitle": "Gỡ bỏ {name}?",
  "marketplace.app.remove.keep": "Giữ",
  // The plugin page section with one row for each app, and the row text by how the app connects.
  // {name} is the app name, {field} the label of its key field, {host} "this computer" or a server name.
  "marketplace.app.connection": "Kết nối",
  "marketplace.app.setup.account": "Đăng nhập bằng tài khoản {name} của bạn trong trình duyệt.",
  "marketplace.app.setup.key": "Cần khóa API từ tài khoản {name} của bạn.",
  "marketplace.app.setup.keySaved": "{field} đã được lưu trên {host}.",
  // {host} is "this computer" or a server name.
  "marketplace.app.account.removeDescription": "OpenBot xóa thông tin đăng nhập của tài khoản này trên {host}.",
  "marketplace.app.setup.desktop": "Chạy trong ứng dụng máy tính {name} tại {address}.",
  "marketplace.app.setup.desktopConnected": "Đã kết nối với {address}.",
  "marketplace.app.setup.open": "Không cần đăng nhập hay khóa.",
  "marketplace.app.blocked.update":
    "{host} chạy phiên bản OpenBot cũ hơn nên không thể kết nối ứng dụng. Hãy cập nhật OpenBot trên {host}, hoặc nhờ chủ sở hữu của nó cập nhật.",
  "marketplace.app.blocked.member":
    "Chỉ chủ sở hữu hoặc quản trị viên của {host} mới có thể kết nối ứng dụng tại đó. Hãy nhờ một người kết nối {name}, hoặc cập nhật OpenBot trên {host} để các thành viên có thể kết nối ứng dụng.",
  "marketplace.app.connectAgain": "Kết nối lại",
  "marketplace.app.automation.askOnInstall": "Yêu cầu macOS cấp quyền khi cài đặt",
  "marketplace.app.automation.title": "Quyền truy cập ứng dụng Apple",
  "marketplace.app.automation.description":
    "macOS hiện một lời nhắc cho mỗi ứng dụng. Một ứng dụng đã đóng sẽ mở trong chốc lát rồi thoát.",
  "marketplace.app.automation.request": "Yêu cầu quyền truy cập",
  "marketplace.app.automation.allowed": "OpenBot giờ có thể điều khiển mọi ứng dụng Apple.",
  "marketplace.app.automation.refused":
    "macOS không cấp quyền truy cập cho {apps}. Hãy cho phép OpenBot trong Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Tự động hóa.",
  "marketplace.app.automation.failed": "OpenBot không thể hỏi macOS về {apps}. Hãy thử lại.",
  "marketplace.app.automation.app.calendar": "Calendar",
  "marketplace.app.automation.app.contacts": "Contacts",
  "marketplace.app.automation.app.mail": "Mail",
  "marketplace.app.automation.app.notes": "Notes",
  "marketplace.app.automation.app.reminders": "Reminders",
  "marketplace.app.automation.app.messages": "Messages",
  "marketplace.app.automation.app.safari": "Safari",
  // The plugin page alert when the server refused an app's saved sign-in.
  "marketplace.app.signInTitle": "Đăng nhập lại {name}",
  "marketplace.app.signInDescription":
    "{name} đã từ chối thông tin đăng nhập đã lưu. Trợ lý của bạn không thể dùng nó cho đến khi bạn đăng nhập lại.",

  // The catalog apps' listing text, by slug. Each English text is the catalog's own text, byte for
  // byte: a key whose English no longer matches the catalog is not used. The prompts are requests that
  // the user sends to an agent.
  "marketplace.plugin.aave.tagline": "Dữ liệu và giao dịch Aave",
  "marketplace.plugin.aave.description":
    "Aave giúp người dùng khám phá các thị trường Aave V3 và V4 đang hoạt động, xem vị thế ví và quản trị DAO, mô phỏng thao tác cho vay và chuẩn bị giao dịch không lưu ký. Mọi giao dịch đều được trả về ở dạng chưa ký: tiện ích đọc thị trường và tạo lệnh gọi, còn ví vẫn ở lại với người dùng.",
  "marketplace.plugin.aave.app":
    "Thị trường V3 và V4 đang hoạt động, vị thế ví, quản trị DAO và giao dịch đã chuẩn bị, qua một máy chủ MCP.",
  "marketplace.plugin.aave.prompt.stablecoinYield":
    "Hiện tại tôi có thể kiếm lãi nhiều nhất trên stablecoin ở đâu trên Aave?",
  "marketplace.plugin.aave.prompt.usdcRates":
    "Hiện tại khoản nào trả lãi cao hơn cho USDC, Aave V3 hay V4 trên Ethereum?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "Hệ số sức khỏe của 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c là bao nhiêu, và cách xa mức thanh lý bao xa?",
  "marketplace.plugin.canva.tagline": "Thiết kế, tài nguyên và bản xuất",
  "marketplace.plugin.canva.description":
    "Canva cho phép người dùng tạo và chỉnh sửa thiết kế bằng lời, tìm kiếm thư viện thiết kế của họ, tải lên và sắp xếp tài nguyên, xuất theo định dạng mà kênh cần, và để lại bình luận ngay tại nơi làm việc. Mỗi người dùng đăng nhập vào tài khoản Canva của riêng họ, và trợ lý có thể làm mọi việc mà tài khoản đó làm được.",
  "marketplace.plugin.canva.app":
    "Tạo và chỉnh sửa thiết kế, tìm kiếm thư viện, quản lý tài nguyên và thương hiệu, bản xuất và bình luận, qua một máy chủ MCP.",
  "marketplace.plugin.canva.prompt.recentDesign": "Hiện thiết kế Canva tôi vừa chỉnh sửa gần nhất.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Đổi kích thước áp phích ra mắt của tôi cho Instagram và xuất cả hai bản ra PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "Biến các ghi chú phát hành này thành một bài thuyết trình Canva sáu trang.",
  "marketplace.plugin.linear.tagline": "Vấn đề và phân loại dự án",
  "marketplace.plugin.linear.description":
    "Linear cho phép trợ lý liệt kê các vấn đề được giao, sắp xếp backlog, cập nhật trạng thái và soạn vấn đề mới trong không gian làm việc mà tài khoản đã đăng nhập thuộc về. Mỗi người dùng đăng nhập vào tài khoản Linear của riêng họ qua trình duyệt.",
  "marketplace.plugin.linear.app":
    "Tìm kiếm vấn đề, phân loại, cập nhật trạng thái và tạo vấn đề, qua máy chủ MCP của Linear với đăng nhập trình duyệt.",
  "marketplace.plugin.linear.prompt.myWeek": "Tuần này có gì được giao cho tôi?",
  "marketplace.plugin.linear.prompt.backlog": "Sắp xếp backlog: mục nào cũ, bị chặn hoặc thiếu chủ sở hữu?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Ghi một vấn đề về lỗi treo trong hàng đợi đồng bộ kèm các bước tái hiện.",
  "marketplace.plugin.notion.tagline": "Tài liệu và cơ sở kiến thức",
  "marketplace.plugin.notion.description":
    "Notion cho phép trợ lý đọc và viết trang, tìm kiếm trong không gian làm việc và lưu ghi chú họp cùng đặc tả ngay nơi nhóm đang làm việc. Mỗi người dùng đăng nhập vào tài khoản Notion của riêng họ qua trình duyệt.",
  "marketplace.plugin.notion.app":
    "Tìm kiếm trang, đọc, viết và điều hướng không gian làm việc, qua máy chủ MCP của Notion với đăng nhập trình duyệt.",
  "marketplace.plugin.notion.prompt.findSpec": "Tìm đặc tả ra mắt hiện tại và tóm tắt các câu hỏi còn bỏ ngỏ.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Biến các gạch đầu dòng này thành một biên bản họp có cấu trúc trong không gian nhóm của tôi.",
  "marketplace.plugin.notion.prompt.updateDoc":
    "Cập nhật tài liệu hướng dẫn làm việc với danh sách kiểm tra phát hành mới.",
  "marketplace.plugin.cobrain.tagline": "Trí nhớ dùng chung cho các trợ lý AI của bạn",
  "marketplace.plugin.cobrain.description":
    "Cobrain là kho trí nhớ Markdown mà mọi AI bạn kết nối đều có thể đọc và viết. Trợ lý nạp ngữ cảnh của một khách hàng hoặc dự án trước khi bắt đầu, tìm kiếm các ghi chú và quyết định trước đó, và lưu lại điều chúng học được để luồng sau bắt đầu từ nơi luồng trước kết thúc. Mỗi người dùng đăng nhập vào tài khoản Cobrain của riêng họ.",
  "marketplace.plugin.cobrain.app": "Đọc, tìm kiếm và viết ghi chú trong não Cobrain của bạn qua một máy chủ MCP.",
  "marketplace.plugin.cobrain.prompt.startSession":
    "Nạp ngữ cảnh Cobrain của tôi cho dự án này trước khi chúng ta bắt đầu.",
  "marketplace.plugin.cobrain.prompt.searchDecision":
    "Tìm trong các ghi chú Cobrain của tôi xem chúng ta đã quyết định gì về giá.",
  "marketplace.plugin.cobrain.prompt.saveNote":
    "Lưu một ghi chú trong Cobrain về những gì chúng ta đã làm hôm nay và phần còn lại.",
  "marketplace.plugin.figma.tagline": "Thiết kế và nguyên mẫu",
  "marketplace.plugin.figma.description":
    "Figma cho phép trợ lý đọc tệp thiết kế, xem các thành phần, kiểu và biến, rồi chuyển đặc tả sản xuất cho kỹ sư. Nó kết nối với máy chủ MCP trong ứng dụng máy tính Figma trên máy tính này. Máy chủ chỉ có thể đọc thiết kế; hỗ trợ ghi đang được phát triển.",
  "marketplace.plugin.figma.app":
    "Ngữ cảnh thiết kế, siêu dữ liệu, biến và ảnh chụp màn hình, qua máy chủ MCP trong ứng dụng máy tính Figma. Hiện chỉ đọc.",
  "marketplace.plugin.figma.prompt.handoff": "Chuyển giao tệp thanh toán: liệt kê các màn hình, thành phần và kiểu.",
  "marketplace.plugin.figma.prompt.audit": "Kiểm tra tệp này xem khoảng cách và màu sắc có nhất quán không.",
  "marketplace.plugin.figma.prompt.assets": "Trích xuất biểu tượng tiếp thị ở kích thước gấp đôi cho bộ ứng dụng.",
  "marketplace.plugin.paper.tagline": "Canvas thiết kế xây dựng trên HTML và CSS",
  "marketplace.plugin.paper.description":
    "Paper cho phép trợ lý đọc và viết tệp thiết kế đang mở trong Paper Desktop: xem artboard, vùng chọn, kiểu đã tính, JSX và token, rồi tạo hoặc sửa frame, văn bản và kiểu. Hãy cài đặt Paper Desktop, mở nó một lần và mở một tệp trước khi bắt đầu. OpenBot khởi chạy Paper CLI do Paper Desktop cài đặt. Paper không cần khóa. Công cụ ghi thay đổi tệp đang mở, vì vậy hãy xem lại mỗi thay đổi trước khi phê duyệt.",
  "marketplace.plugin.paper.app":
    "Đọc và viết tệp Paper Desktop đang mở, qua máy chủ MCP cục bộ mà Paper CLI chuyển tiếp. Cần có Paper Desktop với một tệp đang mở.",
  "marketplace.plugin.paper.prompt.implement":
    "Triển khai frame Paper đã chọn trong codebase này, theo quy ước mã nguồn của chúng ta.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Dùng các kiểu trong kho mã này và thiết kế một trang cài đặt trong Paper.",
  "marketplace.plugin.paper.prompt.tokens":
    "Liệt kê các token thiết kế trong tệp Paper đang mở và so sánh với giao diện của chúng ta.",
  "marketplace.plugin.higgsfield.tagline": "Hình ảnh, video và âm thanh AI",
  "marketplace.plugin.higgsfield.description":
    "Higgsfield cho phép trợ lý tạo hình ảnh, video, nhân vật và âm thanh bằng các mô hình Higgsfield như Seedance, Kling, Veo và MiniMax Hailuo, kiểm tra số tín dụng còn lại và duyệt Thư viện tài nguyên. Kết quả được lưu vào tài nguyên Higgsfield của người dùng. Mỗi người dùng đăng nhập vào tài khoản Higgsfield của riêng họ qua trình duyệt. Mỗi lần tạo dùng tín dụng của tài khoản đó theo mức tiêu chuẩn, kể cả trên gói không giới hạn.",
  "marketplace.plugin.higgsfield.app":
    "Tạo hình ảnh, video và âm thanh, nhân vật, tín dụng và tài nguyên, qua máy chủ MCP của Higgsfield với đăng nhập trình duyệt.",
  "marketplace.plugin.higgsfield.prompt.credits": "Tôi còn bao nhiêu tín dụng Higgsfield?",
  "marketplace.plugin.higgsfield.prompt.productShot": "Tạo ảnh sản phẩm Higgsfield của một chiếc cốc gốm trên bàn gỗ.",
  "marketplace.plugin.higgsfield.prompt.clip": "Tạo video Higgsfield dài 5 giây về sóng biển lúc hoàng hôn.",
  "marketplace.plugin.elevenlabs.tagline": "Giọng nói, giọng đọc và trợ lý giọng nói",
  "marketplace.plugin.elevenlabs.description":
    "ElevenLabs cho phép trợ lý biến văn bản thành giọng nói, làm việc với các giọng đọc và tạo, thử, xem lại các trợ lý giọng nói ElevenLabs cùng các cuộc hội thoại của chúng. Âm thanh tạo ra được trả về dưới dạng liên kết tải xuống có thời hạn ngắn. Mỗi người dùng đăng nhập vào tài khoản ElevenLabs của riêng họ qua trình duyệt, và mỗi lần tạo dùng tín dụng của tài khoản đó.",
  "marketplace.plugin.elevenlabs.app":
    "Chuyển văn bản thành giọng nói, giọng đọc và quản lý trợ lý giọng nói, qua máy chủ MCP của ElevenLabs với đăng nhập trình duyệt.",
  "marketplace.plugin.elevenlabs.prompt.speech":
    "Đọc to đoạn văn này bằng một giọng ElevenLabs điềm tĩnh và đưa tôi tệp âm thanh.",
  "marketplace.plugin.elevenlabs.prompt.agents":
    "Liệt kê các trợ lý giọng nói ElevenLabs của tôi và giọng mà mỗi trợ lý dùng.",
  "marketplace.plugin.elevenlabs.prompt.conversations":
    "Tóm tắt mười cuộc hội thoại gần nhất của trợ lý giọng nói hỗ trợ của tôi.",
  "marketplace.plugin.appleApps.tagline": "Mail, Calendar và nhiều hơn nữa trên máy Mac của bạn",
  "marketplace.plugin.appleApps.description":
    "Apple apps cho phép trợ lý dùng Mail, Calendar, Contacts, Reminders, Notes, Messages và Safari trên máy Mac này. Ứng dụng chỉ hoạt động trên macOS. OpenBot khởi chạy mcp-icloud, một máy chủ cộng đồng không do Apple hay OpenBot tạo ra. Máy chủ điều khiển các ứng dụng qua AppleScript trên máy tính này và không cần tài khoản hay khóa. Khi bạn cài đặt, OpenBot có thể hỏi macOS quyền truy cập tất cả các ứng dụng này cùng lúc, mỗi ứng dụng một lời nhắc. Nếu không, macOS sẽ hỏi vào lần đầu trợ lý dùng một ứng dụng. Để đổi cài đặt này sau, mở Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Tự động hóa. Trợ lý có thể gửi email và iMessages, cùng sửa hoặc xóa sự kiện, danh bạ và nhắc việc, vì vậy hãy xem lại mỗi thay đổi trước khi phê duyệt. Những gì công cụ đọc được, chẳng hạn nội dung email, sẽ được gửi tới nhà cung cấp mô hình của trợ lý.",
  "marketplace.plugin.appleApps.app":
    "Mail, Calendar, Contacts, Reminders, Notes, Messages và Safari, qua máy chủ mcp-icloud cục bộ. Cần macOS và quyền Tự động hóa.",
  "marketplace.plugin.appleApps.prompt.unread": "Tóm tắt các email chưa đọc trong Apple Mail của tôi từ hôm nay.",
  "marketplace.plugin.appleApps.prompt.today": "Hôm nay và ngày mai trên Apple Calendar của tôi có gì?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Tìm email mới nhất về cuộc họp dự án và thêm cuộc họp đó vào lịch của tôi.",
  "marketplace.plugin.sentry.tagline": "Lỗi và phân loại sự cố",
  "marketplace.plugin.sentry.description":
    "Sentry cho phép trợ lý tìm kiếm các lỗi gần đây, xem stack trace và các bản phát hành bị ảnh hưởng, rồi tóm tắt điều gì hỏng sau một lần triển khai. Mỗi người dùng đăng nhập vào tài khoản Sentry của riêng họ qua trình duyệt.",
  "marketplace.plugin.sentry.app":
    "Tìm kiếm lỗi, xem vấn đề và tình trạng bản phát hành, qua máy chủ MCP của Sentry với đăng nhập trình duyệt.",
  "marketplace.plugin.sentry.prompt.newErrors": "Những lỗi mới nào xuất hiện kể từ lần triển khai hôm qua?",
  "marketplace.plugin.sentry.prompt.topCrash":
    "Giải thích sự cố hàng đầu trong dự án di động và nguyên nhân có thể nhất.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Bản phát hành hiện tại khỏe ra so với bản trước thế nào?",
  "marketplace.plugin.gitlab.tagline": "Vấn đề, merge request và pipeline",
  "marketplace.plugin.gitlab.description":
    "GitLab cho phép trợ lý tìm kiếm dự án, đọc và tạo vấn đề, xem xét và cập nhật merge request, đọc tệp kho mã và commit, cùng kiểm tra pipeline và job CI trên GitLab.com. Mỗi người dùng đăng nhập vào tài khoản GitLab của riêng họ qua trình duyệt. Trợ lý có cùng quyền với người dùng: chúng có thể push commit, sửa vấn đề và merge request, và merge chúng. Với GitLab tự host, hãy thêm một máy chủ MCP với địa chỉ GitLab của bạn kèm /api/v4/mcp trong cài đặt máy chủ MCP, rồi đăng nhập tại đó.",
  "marketplace.plugin.gitlab.app":
    "Dự án, vấn đề, merge request, kho mã và pipeline CI, qua máy chủ MCP của GitLab với đăng nhập trình duyệt.",
  "marketplace.plugin.gitlab.prompt.reviewQueue": "Những merge request nào đang chờ tôi xem xét?",
  "marketplace.plugin.gitlab.prompt.failedPipeline": "Vì sao pipeline gần nhất trên nhánh mặc định thất bại?",
  "marketplace.plugin.gitlab.prompt.newIssue":
    "Ghi một vấn đề về lỗi treo trong hàng đợi đồng bộ kèm các bước tái hiện.",
  "marketplace.plugin.vercel.tagline": "Triển khai, nhật ký build và dự án",
  "marketplace.plugin.vercel.description":
    "Vercel cho phép trợ lý liệt kê dự án và các lần triển khai gần đây, đọc nhật ký build và runtime, và tìm lý do một bản build thất bại. Mỗi người dùng đăng nhập vào tài khoản Vercel của riêng họ qua trình duyệt và chọn các nhóm mà trợ lý có thể dùng. Trong những nhóm đó, trợ lý có cùng quyền với tài khoản của người dùng. Chúng cũng có thể sửa biến môi trường, tên miền, bản ghi DNS và các lần triển khai, cũng như mua tên miền.",
  "marketplace.plugin.vercel.app":
    "Dự án, triển khai, nhật ký build và nhật ký runtime, qua máy chủ MCP của Vercel với đăng nhập trình duyệt.",
  "marketplace.plugin.vercel.prompt.failedBuild": "Vì sao lần triển khai production gần nhất thất bại?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "Liệt kê các lần triển khai hôm nay và trạng thái của chúng.",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "Những route nào gặp lỗi runtime trong giờ qua?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, lưu trữ và nhật ký",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare cho phép trợ lý liệt kê và quản lý Workers, bản ghi DNS, R2, D1 và KV qua Cloudflare API, truy vấn nhật ký Workers và tìm kiếm tài liệu Cloudflare. Mỗi người dùng đăng nhập vào tài khoản Cloudflare của riêng họ qua trình duyệt. Trên trang đồng ý của Cloudflare, hãy chọn Read only: mặc định Minimal không cho trợ lý xem Workers, nhật ký hay bản ghi DNS. Với quyền ghi, trợ lý có thể triển khai và xóa Workers, sửa bản ghi DNS và sửa các cài đặt tài khoản khác.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, lưu trữ và nhật ký, qua máy chủ MCP API của Cloudflare với đăng nhập trình duyệt.",
  "marketplace.plugin.cloudflare.prompt.workers":
    "Những Worker nào đã được triển khai trong tài khoản Cloudflare của tôi?",
  "marketplace.plugin.cloudflare.prompt.errors": "Những Worker Cloudflare nào đã ghi lỗi trong giờ qua?",
  "marketplace.plugin.cloudflare.prompt.dns":
    "Liệt kê các bản ghi DNS của từng zone trong tài khoản Cloudflare của tôi.",
  "marketplace.plugin.supabase.tagline": "Cơ sở dữ liệu, nhật ký và edge function",
  "marketplace.plugin.supabase.description":
    "Supabase cho phép trợ lý liệt kê dự án, chạy SQL, đọc lược đồ bảng và nhật ký, kiểm tra cố vấn bảo mật và hiệu năng, quản lý edge function và nhánh, cùng tìm kiếm tài liệu Supabase. Mỗi người dùng đăng nhập vào tài khoản Supabase của riêng họ qua trình duyệt và chọn một tổ chức. Trợ lý có toàn quyền truy cập: chúng có thể chạy SQL thay đổi hoặc xóa dữ liệu, áp dụng migration, triển khai edge function, và tạo hoặc tạm dừng dự án.",
  "marketplace.plugin.supabase.app":
    "Cơ sở dữ liệu, nhật ký và edge function, qua máy chủ MCP của Supabase với đăng nhập trình duyệt.",
  "marketplace.plugin.supabase.prompt.projects": "Những dự án nào có trong tổ chức Supabase của tôi?",
  "marketplace.plugin.supabase.prompt.tables": "Liệt kê các bảng và cột của cơ sở dữ liệu Supabase của tôi.",
  "marketplace.plugin.supabase.prompt.errors": "Những lỗi nào dự án Supabase của tôi đã ghi trong giờ qua?",
  "marketplace.plugin.context7.tagline": "Tài liệu thư viện hiện hành",
  "marketplace.plugin.context7.description":
    "Context7 lấy tài liệu và tham chiếu API hiện hành của các thư viện và framework, để câu trả lời dùng đúng phiên bản mà dự án đang chạy. Nó không cần tài khoản hay khóa.",
  "marketplace.plugin.context7.app":
    "Tra cứu tài liệu thư viện hiện hành, qua máy chủ MCP của Context7 mà không cần đăng nhập.",
  "marketplace.plugin.context7.prompt.apiCheck": "API hiện tại cho danh sách ảo hóa trong framework này là gì?",
  "marketplace.plugin.context7.prompt.migrate": "Điều gì thay đổi giữa v2 và v3 của router này?",
  "marketplace.plugin.context7.prompt.example": "Cho tôi xem một ví dụ hiện hành về tải tệp có xác thực.",
  "marketplace.plugin.stripe.tagline": "Thanh toán và kiểm tra hóa đơn",
  "marketplace.plugin.stripe.description":
    "Stripe cho phép trợ lý tra cứu thanh toán, khách hàng và hóa đơn, cùng soạn liên kết thanh toán, trong tài khoản mà người dùng đã đăng nhập có thể truy cập. Mỗi người dùng đăng nhập vào tài khoản Stripe của riêng họ qua trình duyệt.",
  "marketplace.plugin.stripe.app":
    "Tra cứu thanh toán, khách hàng và hóa đơn, qua máy chủ MCP của Stripe với đăng nhập trình duyệt.",
  "marketplace.plugin.stripe.prompt.payment": "Tra cứu khoản thanh toán này và giải thích vì sao nó thất bại.",
  "marketplace.plugin.stripe.prompt.customer": "Tóm tắt các hóa đơn và số dư còn nợ của khách hàng này.",
  "marketplace.plugin.stripe.prompt.link": "Soạn một liên kết thanh toán cho gói Pro giá 49 mỗi tháng.",
  "marketplace.plugin.revenuecat.tagline": "Gói đăng ký, sản phẩm và paywall",
  "marketplace.plugin.revenuecat.description":
    "RevenueCat cho phép trợ lý đọc và thay đổi cấu hình gói đăng ký trong ứng dụng của bạn: ứng dụng, sản phẩm, entitlement, offering, gói, paywall và thử nghiệm. Trợ lý cũng có thể tra cứu khách hàng và các giao dịch mua của họ, cùng đọc biểu đồ và chỉ số. Một khóa API bí mật của RevenueCat nằm trong một header Authorization. Khóa này chỉ tới được một dự án. Với khóa chỉ đọc, trợ lý chỉ có thể đọc. Với khóa ghi, trợ lý có thể gửi sản phẩm lên App Store để xét duyệt, cấp entitlement cho khách hàng, và xóa gói, quy tắc nhắm mục tiêu và webhook.",
  "marketplace.plugin.revenuecat.app":
    "Sản phẩm, entitlement, offering, paywall và chỉ số, qua máy chủ MCP của RevenueCat với khóa API bí mật.",
  "marketplace.plugin.revenuecat.prompt.offerings": "Dự án RevenueCat của tôi có những offering và gói nào?",
  "marketplace.plugin.revenuecat.prompt.revenue":
    "Doanh thu và số gói đăng ký đang hoạt động của RevenueCat thay đổi thế nào trong tháng này?",
  "marketplace.plugin.revenuecat.prompt.customer":
    "Khách hàng RevenueCat này có những entitlement nào, và chúng hết hạn khi nào?",
  "marketplace.plugin.revenuecat.hint.apiKey":
    "Trong bảng điều khiển RevenueCat, mở API keys trong dự án của bạn và tạo một khóa API bí mật. Khóa chỉ đọc là đủ để xem dữ liệu.",
  "marketplace.plugin.posthog.tagline": "Phân tích sản phẩm và cờ tính năng",
  "marketplace.plugin.posthog.description":
    "PostHog cho phép trợ lý truy vấn sự kiện và phễu, xem các cờ tính năng, và tóm tắt điều gì thay đổi sau một bản phát hành. Một khóa API cá nhân từ cài đặt dự án nằm trong một header Authorization.",
  "marketplace.plugin.posthog.app":
    "Truy cập sự kiện, phễu và cờ tính năng, qua máy chủ MCP của PostHog với khóa API cá nhân.",
  "marketplace.plugin.posthog.prompt.funnel": "Phễu đăng ký trong 14 ngày qua trông thế nào?",
  "marketplace.plugin.posthog.prompt.flag": "Những cờ tính năng nào đang bật cho người dùng này?",
  "marketplace.plugin.posthog.prompt.release": "Số lượt kích hoạt có thay đổi sau bản phát hành tuần trước không?",
  "marketplace.plugin.airtable.tagline": "Base và bản ghi",
  "marketplace.plugin.airtable.description":
    "Airtable cho phép trợ lý liệt kê các base, đọc và cập nhật bản ghi, và tóm tắt nội dung bảng. Một khóa API từ trang tài khoản được truyền cho máy chủ cục bộ dưới dạng một biến môi trường.",
  "marketplace.plugin.airtable.app": "Liệt kê base và truy cập bản ghi, qua máy chủ MCP cục bộ với khóa API Airtable.",
  "marketplace.plugin.airtable.prompt.bases": "Tôi có quyền truy cập những base nào?",
  "marketplace.plugin.airtable.prompt.records": "Tóm tắt bảng theo dõi ra mắt.",
  "marketplace.plugin.airtable.prompt.update": "Đánh dấu các tính năng đã phát hành là hoàn tất trong base lộ trình.",
  "marketplace.plugin.firecrawl.tagline": "Trích xuất và tìm kiếm web",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl cho phép trợ lý thu thập trang, trích xuất dữ liệu có cấu trúc và tìm kiếm web qua một API. Một khóa API từ bảng điều khiển Firecrawl được truyền cho máy chủ cục bộ dưới dạng một biến môi trường.",
  "marketplace.plugin.firecrawl.app":
    "Thu thập trang, trích xuất và tìm kiếm web, qua máy chủ MCP cục bộ với khóa API Firecrawl.",
  "marketplace.plugin.firecrawl.prompt.scrape": "Trích xuất bảng giá từ trang này dưới dạng dữ liệu có cấu trúc.",
  "marketplace.plugin.firecrawl.prompt.research": "Nghiên cứu giá của đối thủ và dẫn nguồn cho từng trang nguồn.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Trang nhật ký thay đổi của chúng ta đã thay đổi gì trong tháng này?",
  "marketplace.plugin.braveSearch.tagline": "Tìm kiếm web riêng tư",
  "marketplace.plugin.braveSearch.description":
    "Brave Search cho phép trợ lý tìm kiếm web và kết quả cục bộ mà không theo dõi. Một khóa API từ bảng điều khiển Brave Search API được truyền cho máy chủ cục bộ dưới dạng một biến môi trường.",
  "marketplace.plugin.braveSearch.app": "Tìm kiếm web và cục bộ, qua máy chủ MCP cục bộ với khóa API Brave.",
  "marketplace.plugin.braveSearch.prompt.search": "Các nhà đánh giá nói gì về phiên bản framework này?",
  "marketplace.plugin.braveSearch.prompt.news": "Tìm các thông báo hôm nay cho lĩnh vực sản phẩm này.",
  "marketplace.plugin.braveSearch.prompt.compare": "So sánh hai nhà cung cấp này kèm nguồn dẫn.",
  "marketplace.plugin.obsidian.tagline": "Ghi chú trong kho của bạn",
  "marketplace.plugin.obsidian.description":
    "Obsidian cho phép trợ lý tìm kiếm, đọc và viết các ghi chú trong kho của bạn, để kho đó có thể là trí nhớ của chúng. Máy chủ cục bộ kết nối với tiện ích Local REST API trong ứng dụng Obsidian trên máy tính này. Khóa API của tiện ích được truyền cho máy chủ cục bộ dưới dạng một biến môi trường. Hãy giữ Obsidian mở trong khi trợ lý dùng nó.",
  "marketplace.plugin.obsidian.app":
    "Tìm kiếm, đọc và chỉnh sửa ghi chú, qua máy chủ MCP cục bộ với khóa của tiện ích Local REST API.",
  "marketplace.plugin.obsidian.prompt.recall": "Các ghi chú của tôi nói gì về các quyết định của dự án này?",
  "marketplace.plugin.obsidian.prompt.save": "Lưu quyết định này thành một ghi chú mới trong kho của tôi.",
  "marketplace.plugin.obsidian.prompt.log": "Thêm tóm tắt công việc hôm nay vào ghi chú Work log của tôi.",
  "marketplace.plugin.obsidian.hint.apiKey":
    'Trong Obsidian, mở Settings > Local REST API. Sao chép khóa API và bật "Enable non-encrypted (HTTP) server".',
  "marketplace.plugin.resend.tagline": "Email giao dịch",
  "marketplace.plugin.resend.description":
    "Resend cho phép trợ lý gửi email giao dịch và kiểm tra việc giao qua một API. Một khóa API từ bảng điều khiển Resend được truyền cho máy chủ cục bộ dưới dạng một biến môi trường.",
  "marketplace.plugin.resend.app": "Gửi email và kiểm tra việc giao, qua máy chủ MCP cục bộ với khóa API Resend.",
  "marketplace.plugin.resend.prompt.send": "Gửi bản nháp thông báo ra mắt tới danh sách beta.",
  "marketplace.plugin.resend.prompt.status": "Email hóa đơn đã đến khách hàng chưa?",
  "marketplace.plugin.resend.prompt.template": "Soạn một email đặt lại mật khẩu cho quy trình mới.",
  "marketplace.plugin.omnisend.tagline": "Tiếp thị email và SMS",
  "marketplace.plugin.omnisend.description":
    "Omnisend cho phép trợ lý đọc báo cáo chiến dịch và biểu mẫu, tìm liên hệ và phân khúc, cùng tạo và chỉnh sửa chiến dịch, quy trình tự động, mẫu email, biểu mẫu và sản phẩm. Mỗi người dùng đăng nhập vào tài khoản Omnisend của riêng họ qua trình duyệt và chọn mức truy cập trên màn hình đồng ý. Với quyền ghi, trợ lý còn có thể gửi chiến dịch và xóa dữ liệu. Hãy chọn quyền chỉ đọc khi trợ lý chỉ cần báo cáo.",
  "marketplace.plugin.omnisend.app":
    "Chiến dịch, quy trình tự động, liên hệ, phân khúc, biểu mẫu và báo cáo, qua máy chủ MCP của Omnisend với đăng nhập trình duyệt.",
  "marketplace.plugin.omnisend.prompt.lastCampaign":
    "Các chiến dịch tuần trước đạt kết quả thế nào so với tuần trước nữa?",
  "marketplace.plugin.omnisend.prompt.segment": "Phân khúc VIP có bao nhiêu liên hệ, và tháng này nó thay đổi thế nào?",
  "marketplace.plugin.omnisend.prompt.draftCampaign": "Soạn một chiến dịch cho bộ sưu tập mới, nhưng đừng gửi.",
  "marketplace.plugin.composio.tagline": "Gmail, Slack, GitHub và hơn 1.000 ứng dụng khác",
  "marketplace.plugin.composio.description":
    "Composio kết nối trợ lý của bạn với Gmail, Slack, GitHub và hơn 1.000 ứng dụng khác qua một máy chủ MCP. Hãy đăng nhập bằng tài khoản Composio của bạn. Khi một trợ lý cần một ứng dụng, nó sẽ nhờ bạn kết nối ứng dụng đó.",
  "marketplace.plugin.composio.app":
    "Các ứng dụng bạn kết nối trong tài khoản Composio. Một trợ lý nhờ bạn kết nối ứng dụng khi nó cần đến.",
  "marketplace.plugin.composio.prompt.inbox": "Tóm tắt email chưa đọc của tôi và soạn trả lời cho các email gấp.",
  "marketplace.plugin.composio.prompt.handoff": "Đăng tóm tắt pull request này vào kênh của nhóm chúng ta.",
  "marketplace.plugin.composio.prompt.apps": "Bạn có thể dùng những ứng dụng và hành động nào qua Composio?",
  // The connect form text of the catalog listings. Each English text is the catalog's own text, byte for byte.
  "marketplace.plugin.composio.hint.apiKey":
    "Tìm nó trong tài khoản Composio của bạn, tại Settings > Sessions & API Key.",
  "marketplace.plugin.neon.tagline": "Dự án Postgres, nhánh và migration",
  "marketplace.plugin.neon.description":
    "Neon cho phép trợ lý liệt kê dự án và nhánh, chạy SQL, đọc lược đồ bảng, thử thay đổi lược đồ trên một nhánh tạm, tìm truy vấn chậm, và tìm kiếm tài liệu Neon. Mỗi người dùng đăng nhập vào tài khoản Neon của riêng họ qua trình duyệt và có thể chọn quyền chỉ đọc khi cấp quyền. Với toàn quyền truy cập, trợ lý có thể chạy SQL thay đổi hoặc xóa dữ liệu, và tạo, đặt lại hoặc xóa nhánh, cơ sở dữ liệu và dự án. Neon khuyến nghị dùng máy chủ MCP của nó cho phát triển và thử nghiệm, không dùng cho cơ sở dữ liệu production.",
  "marketplace.plugin.neon.app":
    "Dự án Postgres, nhánh, SQL và migration, qua máy chủ MCP của Neon với đăng nhập trình duyệt.",
  "marketplace.plugin.neon.prompt.projects": "Những dự án và nhánh nào có trong tài khoản Neon của tôi?",
  "marketplace.plugin.neon.prompt.slowQueries":
    "Những truy vấn nào chậm nhất trên cơ sở dữ liệu Neon của tôi, và vì sao?",
  "marketplace.plugin.neon.prompt.migration":
    "Thêm một index vào bảng orders trên một nhánh tạm, và cho tôi xem kết quả trước khi bạn áp dụng.",
  "marketplace.plugin.prisma.tagline": "Cơ sở dữ liệu Postgres, sao lưu và ứng dụng Compute",
  "marketplace.plugin.prisma.description":
    "Prisma cho phép trợ lý liệt kê và tạo cơ sở dữ liệu Prisma Postgres, đọc lược đồ, chạy SQL, liệt kê các bản sao lưu và khôi phục chúng vào một cơ sở dữ liệu mới, quản lý bucket Object Storage, đọc các bản build và nhật ký Compute, cùng tìm kiếm tài liệu Prisma. Mỗi người dùng đăng nhập vào tài khoản Prisma của riêng họ qua trình duyệt và chọn một không gian làm việc. Trợ lý có toàn quyền truy cập: chúng có thể chạy SQL thay đổi hoặc xóa dữ liệu, cập nhật lược đồ, xóa cơ sở dữ liệu và bucket, và dừng, hoàn tác hoặc xóa các bản triển khai Compute.",
  "marketplace.plugin.prisma.app":
    "Cơ sở dữ liệu, SQL, sao lưu và ứng dụng Compute, qua máy chủ MCP của Prisma với đăng nhập trình duyệt.",
  "marketplace.plugin.prisma.prompt.databases": "Những cơ sở dữ liệu nào có trong không gian làm việc Prisma của tôi?",
  "marketplace.plugin.prisma.prompt.backups": "Cho tôi xem tất cả bản sao lưu có sẵn của cơ sở dữ liệu.",
  "marketplace.plugin.prisma.prompt.logs": "Cho tôi xem nhật ký runtime của bản triển khai Compute gần nhất.",
  "marketplace.plugin.netlify.tagline": "Dự án, lần triển khai và nhật ký yêu cầu",
  "marketplace.plugin.netlify.description":
    "Netlify cho phép trợ lý liệt kê dự án và các lần triển khai, đọc nhật ký yêu cầu edge, tạo dự án và triển khai mã nguồn vào một dự án có sẵn. Mỗi người dùng đăng nhập vào tài khoản Netlify của riêng họ qua trình duyệt. Trợ lý có cùng quyền truy cập với tài khoản của người dùng: chúng có thể sửa biến môi trường, biểu mẫu và quyền truy cập của khách truy cập, cài đặt hoặc gỡ tiện ích mở rộng, và xóa dữ liệu biểu mẫu đã gửi cùng biến môi trường.",
  "marketplace.plugin.netlify.app":
    "Dự án, lần triển khai, nhật ký yêu cầu và cài đặt trang, qua máy chủ MCP của Netlify với đăng nhập trình duyệt.",
  "marketplace.plugin.netlify.prompt.latestDeploy":
    "Trạng thái lần triển khai gần nhất của từng dự án Netlify của tôi là gì?",
  "marketplace.plugin.netlify.prompt.errors": "Những URL nào trên trang của tôi trả về lỗi máy chủ trong ngày qua?",
  "marketplace.plugin.netlify.prompt.deploy": "Triển khai thư mục này vào dự án Netlify hiện có của tôi.",
  "marketplace.plugin.railway.tagline": "Dự án, dịch vụ và lần triển khai",
  "marketplace.plugin.railway.description":
    "Railway cho phép trợ lý liệt kê dự án và dịch vụ, tạo dự án, triển khai lại dịch vụ và quản lý các cờ tính năng. Trợ lý còn có thể giao việc nhiều bước cho Railway Agent, bộ phận đọc nhật ký, tìm lý do một lần triển khai thất bại, tạo dịch vụ và đặt biến. Mỗi người dùng đăng nhập vào tài khoản Railway của riêng họ qua trình duyệt và chọn các không gian làm việc và dự án mà trợ lý có thể dùng. Trợ lý có toàn quyền truy cập trong những dự án đó: chúng có thể triển khai thay đổi theo giai đoạn, xóa cờ tính năng, và thay đổi dịch vụ, biến, cơ sở dữ liệu và mạng qua Railway Agent.",
  "marketplace.plugin.railway.app":
    "Dự án, dịch vụ và lần triển khai, qua máy chủ MCP của Railway với đăng nhập trình duyệt.",
  "marketplace.plugin.railway.prompt.projects":
    "Những dự án và dịch vụ nào có trong không gian làm việc Railway của tôi?",
  "marketplace.plugin.railway.prompt.crash": "Vì sao dịch vụ backend của tôi trên Railway lại lỗi khi triển khai?",
  "marketplace.plugin.railway.prompt.redeploy": "Triển khai lại dịch vụ API trong dự án Railway của tôi.",
  "marketplace.plugin.render.tagline": "Dịch vụ, lần triển khai và nhật ký",
  "marketplace.plugin.render.description":
    "Render cho phép trợ lý liệt kê các không gian làm việc và dịch vụ, đọc nhật ký, sự kiện và chỉ số, xem lịch sử triển khai, kích hoạt triển khai, và chạy SQL chỉ đọc trên Render Postgres. Một khóa API của Render nằm trong một header Authorization. Khóa này tới được mọi không gian làm việc của tài khoản Render. Trợ lý có thể tạo dịch vụ web, trang tĩnh, cron job, cơ sở dữ liệu Postgres và thực thể Key Value, những thứ có thể tốn tiền, và chúng có thể thay thế các biến môi trường của một dịch vụ. Máy chủ không thể xóa tài nguyên.",
  "marketplace.plugin.render.app":
    "Dịch vụ, lần triển khai, nhật ký và chỉ số, qua máy chủ MCP của Render với khóa API.",
  "marketplace.plugin.render.prompt.services": "Những dịch vụ nào có trong không gian làm việc Render của tôi?",
  "marketplace.plugin.render.prompt.logs": "Những lỗi nào dịch vụ web Render của tôi đã ghi trong giờ qua?",
  "marketplace.plugin.render.prompt.deploy": "Vì sao lần triển khai gần nhất của dịch vụ Render của tôi thất bại?",
  "marketplace.plugin.atlassian.tagline": "Hạng mục Jira và trang Confluence",
  "marketplace.plugin.atlassian.description":
    "Atlassian cho phép trợ lý tìm kiếm và đọc hạng mục Jira, trang Confluence và pull request Bitbucket, cùng tạo hoặc cập nhật hạng mục, trang và bình luận. Mỗi người dùng đăng nhập vào tài khoản Atlassian của riêng họ qua trình duyệt và chấp thuận quyền truy cập trên màn hình đồng ý. Trợ lý có cùng quyền với người dùng: chúng có thể sửa hạng mục và trang, sửa quyền của trang, và merge pull request. Các công cụ xóa dữ liệu Jira vẫn tắt cho đến khi quản trị viên tổ chức bật. Mỗi lần gọi công cụ dùng tín dụng Rovo.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence và Bitbucket, qua máy chủ MCP của Atlassian với đăng nhập trình duyệt.",
  "marketplace.plugin.atlassian.prompt.assigned": "Những hạng mục Jira đang mở nào được giao cho tôi?",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "Tìm trang Confluence về quy trình phát hành của chúng ta và tóm tắt.",
  "marketplace.plugin.atlassian.prompt.newItem": "Tạo một hạng mục Jira cho lỗi đăng nhập kèm các bước tái hiện.",
  "marketplace.plugin.todoist.tagline": "Công việc, dự án và nhắc việc",
  "marketplace.plugin.todoist.description":
    "Todoist cho phép trợ lý tìm công việc theo ngày, nội dung, nhãn hoặc bộ lọc, thêm và dời lịch công việc, cùng quản lý dự án, mục, nhãn, bình luận và nhắc việc. Mỗi người dùng đăng nhập vào tài khoản Todoist của riêng họ qua trình duyệt. Trợ lý có quyền đọc và ghi: chúng có thể sửa, hoàn thành và xóa công việc, dự án và các mục khác.",
  "marketplace.plugin.todoist.app":
    "Công việc, dự án và nhắc việc, qua máy chủ MCP của Todoist với đăng nhập trình duyệt.",
  "marketplace.plugin.todoist.prompt.today": "Những công việc Todoist nào đến hạn hôm nay?",
  "marketplace.plugin.todoist.prompt.capture": "Thêm các hạng mục này vào Todoist Inbox của tôi.",
  "marketplace.plugin.todoist.prompt.overdue": "Chuyển các công việc Todoist quá hạn của tôi sang ngày mai.",
  "marketplace.plugin.ticktick.tagline": "Công việc, danh sách, thói quen và tập trung",
  "marketplace.plugin.ticktick.description":
    "TickTick cho phép trợ lý tìm kiếm và lọc công việc, thêm và cập nhật công việc, cùng quản lý danh sách, mục, thư mục, thẻ và bình luận. Trợ lý còn có thể đọc và sửa thói quen cùng bản ghi tập trung, và đọc sự kiện từ các lịch đã kết nối với TickTick. Mỗi người dùng đăng nhập vào tài khoản TickTick của riêng họ qua trình duyệt. Trợ lý có quyền đọc và ghi: chúng có thể hoàn thành, chuyển và xóa công việc, cùng xóa thẻ và bản ghi tập trung.",
  "marketplace.plugin.ticktick.app":
    "Công việc, danh sách, thói quen và bản ghi tập trung, qua máy chủ MCP của TickTick với đăng nhập trình duyệt.",
  "marketplace.plugin.ticktick.prompt.today": "Những công việc TickTick nào đến hạn hôm nay?",
  "marketplace.plugin.ticktick.prompt.capture": "Thêm các hạng mục này vào TickTick Inbox của tôi.",
  "marketplace.plugin.ticktick.prompt.week": "Tuần trước tôi đã hoàn thành những công việc TickTick nào?",
  "marketplace.plugin.trello.tagline": "Bảng, danh sách và thẻ",
  "marketplace.plugin.trello.description":
    "Trello cho phép trợ lý tìm kiếm và đọc bảng, danh sách, thẻ, danh sách kiểm tra và bình luận, tạo bảng và thẻ, chuyển danh sách và thẻ, đánh dấu thẻ đã xong, và thêm danh sách kiểm tra, bình luận và nhãn. Trợ lý còn có thể đọc và thêm thẻ trong Trello Inbox của người dùng, và đọc sự kiện Planner, sự kiện này có thể đến từ lịch Google hoặc Outlook đã kết nối. Mỗi người dùng đăng nhập vào tài khoản Trello của riêng họ qua trình duyệt và chọn các không gian làm việc trên màn hình đồng ý. Trợ lý có cùng quyền với người dùng trong những không gian làm việc đó. Chúng có thể lưu trữ thẻ và danh sách, nhưng máy chủ không thể xóa vĩnh viễn bất cứ thứ gì.",
  "marketplace.plugin.trello.app": "Bảng, danh sách và thẻ, qua máy chủ MCP của Trello với đăng nhập trình duyệt.",
  "marketplace.plugin.trello.prompt.myCards": "Những thẻ Trello nào được giao cho tôi?",
  "marketplace.plugin.trello.prompt.board": "Tóm tắt những gì đang thực hiện trên bảng Trello của tôi.",
  "marketplace.plugin.trello.prompt.newCards": "Thêm các hạng mục này dưới dạng thẻ vào bảng Trello của tôi.",
  "marketplace.plugin.clickup.tagline": "Công việc, tài liệu và cập nhật nhóm",
  "marketplace.plugin.clickup.description":
    "ClickUp cho phép trợ lý tìm kiếm công việc, tài liệu, bình luận và trò chuyện, tạo và cập nhật công việc, danh sách và tài liệu, đăng bình luận, gửi tin nhắn trò chuyện và theo dõi thời gian. Mỗi người dùng đăng nhập vào tài khoản ClickUp của riêng họ qua trình duyệt. Trợ lý có cùng quyền với người dùng. Chúng có thể chuyển công việc vào thùng rác và xóa bình luận.",
  "marketplace.plugin.clickup.app":
    "Công việc, tài liệu, bình luận, trò chuyện và theo dõi thời gian, qua máy chủ MCP của ClickUp với đăng nhập trình duyệt.",
  "marketplace.plugin.clickup.prompt.findTasks": "Tìm các công việc ClickUp đang mở của tôi đến hạn trong tuần này.",
  "marketplace.plugin.clickup.prompt.createTask": "Tạo một công việc ClickUp cho các hạng mục này và giao cho tôi.",
  "marketplace.plugin.clickup.prompt.summarizeDoc":
    "Tìm bản cập nhật dự án gần nhất trong ClickUp và tóm tắt các câu hỏi còn bỏ ngỏ.",
  "marketplace.plugin.coinbase.tagline": "Giá tiền mã hóa, danh mục và giao dịch",
  "marketplace.plugin.coinbase.description":
    "Coinbase cho phép trợ lý đọc giá, số dư, danh mục, lệnh và phí trong Coinbase Advanced Trade, xem trước và đặt lệnh, chuyển đổi giữa các tài sản, và chuyển tiền giữa các danh mục. Mỗi người dùng đăng nhập vào tài khoản Coinbase của riêng họ qua trình duyệt. Trợ lý có cùng quyền với người dùng. Lệnh và chuyển đổi dùng tiền thật, và trợ lý có thể trả tiền cho các yêu cầu x402 bằng số dư USDC.",
  "marketplace.plugin.coinbase.app":
    "Giá, số dư, danh mục, lệnh và chuyển đổi, qua máy chủ MCP của Coinbase với đăng nhập trình duyệt.",
  "marketplace.plugin.coinbase.prompt.balances": "Số dư Coinbase của tôi trong mỗi danh mục là bao nhiêu?",
  "marketplace.plugin.coinbase.prompt.price": "Hiện giá BTC-USD trên Coinbase và mức biến động của nó trong tuần này.",
  "marketplace.plugin.coinbase.prompt.previewOrder":
    "Xem trước một lệnh mua thị trường 50 USD ETH trên Coinbase. Đừng đặt lệnh.",
  "marketplace.plugin.robinhood.tagline": "Tài khoản môi giới và giao dịch bằng trợ lý",
  "marketplace.plugin.robinhood.description":
    "Robinhood cho phép trợ lý đọc các tài khoản, vị thế, số dư, lịch sử giao dịch và danh sách theo dõi của một khách hàng Robinhood, đọc dữ liệu thị trường, và đặt lệnh cổ phiếu, quyền chọn và tiền mã hóa. Mỗi người dùng đăng nhập vào tài khoản Robinhood của riêng họ qua trình duyệt. Khi đăng nhập lần đầu, Robinhood nhờ người dùng mở một tài khoản Agentic riêng. Trợ lý chỉ có thể giao dịch trong tài khoản đó, và mặc định chúng đặt lệnh mà không hỏi người dùng phê duyệt từng lệnh.",
  "marketplace.plugin.robinhood.app":
    "Tài khoản, vị thế, dữ liệu thị trường và giao dịch, qua máy chủ MCP của Robinhood với đăng nhập trình duyệt.",
  "marketplace.plugin.robinhood.prompt.positions": "Tóm tắt các vị thế Robinhood của tôi và mức biến động hôm nay.",
  "marketplace.plugin.robinhood.prompt.watchlist":
    "Từng cổ phiếu trong danh sách theo dõi Robinhood của tôi đã biến động thế nào trong tuần này?",
  "marketplace.plugin.robinhood.prompt.agenticCash":
    "Trong tài khoản Robinhood Agentic của tôi còn bao nhiêu tiền mặt?",
  "marketplace.plugin.huggingface.tagline": "Mô hình, tập dữ liệu và bài báo trên Hub",
  "marketplace.plugin.huggingface.description":
    "Hugging Face cho phép trợ lý tìm kiếm mô hình, tập dữ liệu, Space, bộ sưu tập và bài báo trên Hugging Face Hub, đọc model card và tệp kho mã, xem trước tập dữ liệu, và tìm kiếm tài liệu Hugging Face. Nó dùng dữ liệu Hub công khai và không cần tài khoản hay khóa. Các công cụ chỉ đọc: trợ lý không thể tạo kho mã hay chạy job.",
  "marketplace.plugin.huggingface.app":
    "Tìm kiếm mô hình, tập dữ liệu, Space, bài báo và tài liệu, qua máy chủ MCP của Hugging Face mà không cần đăng nhập.",
  "marketplace.plugin.huggingface.prompt.models":
    "Tìm các mô hình mở nhỏ dùng cho nhận dạng giọng nói trên Hugging Face.",
  "marketplace.plugin.huggingface.prompt.papers": "Những bài báo nào đang thịnh hành trên Hugging Face hôm nay?",
  "marketplace.plugin.huggingface.prompt.dataset":
    "Tìm một tập dữ liệu chuỗi thời gian thời tiết và cho tôi xem các cột của nó.",
  "marketplace.auth.apiKey": "Khóa API",
  "marketplace.auth.personalApiKey": "Khóa API cá nhân",
  "marketplace.auth.createKey": "Tạo khóa",

  // Skills.
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Thử trong {name}",

  // The Skills tab. {name} is a skill, a group or a sort name. {agents} is a list of agent names,
  // "all agents" or "4 agents". {agent} is one agent name. {state} is one or more states.
  "marketplace.skills.yours": "Kỹ năng của bạn",
  "marketplace.skills.seeAll": "Xem tất cả",
  "marketplace.skills.seeAllName": "Xem tất cả: {name}",
  "marketplace.skills.none": "Chưa có trợ lý nào có kỹ năng.",
  "marketplace.skills.noneHint":
    "Một kỹ năng dạy trợ lý một nhiệm vụ. Hãy thêm một kỹ năng bên dưới, hoặc tạo kỹ năng của riêng bạn.",
  "marketplace.skills.sourceLabel": "Nguồn",
  "marketplace.skills.source.all": "Tất cả",
  "marketplace.skills.source.verified": "Đã xác minh",
  "marketplace.skills.source.public": "Công khai",
  "marketplace.skills.source.verifiedLong": "Được OpenBot xác minh",
  "marketplace.skills.source.publicLong": "Được OpenBot kiểm duyệt",
  "marketplace.skills.sortLabel": "Sắp xếp",
  "marketplace.skills.sortName": "Sắp xếp: {name}",
  "marketplace.skills.sort.installs": "Dùng nhiều nhất",
  "marketplace.skills.sort.updated": "Cập nhật gần đây",
  "marketplace.skills.sort.name": "Tên",
  "marketplace.skills.featured": "Nổi bật",
  "marketplace.skills.all": "Tất cả kỹ năng",
  "marketplace.skills.count": { other: "{count} kỹ năng" },
  "marketplace.skills.searchIn": "Tìm kiếm {name}",
  "marketplace.skills.missing": "Kỹ năng này không có trong Cửa hàng.",
  "marketplace.skills.state.off": "Tắt",
  "marketplace.skills.state.repair": "Cần sửa",
  "marketplace.skills.state.update": "Có bản cập nhật",
  "marketplace.skills.state.modified": "Bạn đã thay đổi",
  "marketplace.skills.stateOn": "{state} trên {agents}",
  "marketplace.skills.version": "Phiên bản {version}",
  "marketplace.skills.origin.local": "Tạo trên máy tính này",
  "marketplace.skills.origin.workspace": "Trong thư mục của trợ lý này",
  "marketplace.skills.origin.marketplace": "Từ Cửa hàng · phiên bản {version}",
  "marketplace.skills.status.notAdded": "Chưa thêm",
  "marketplace.skills.status.on": "Bật trên {agents}",
  "marketplace.skills.agentCount": { other: "{count} trợ lý" },
  "marketplace.skills.allAgents": "tất cả trợ lý",
  "marketplace.skills.agentsTitle": "Trợ lý · {total}",
  "marketplace.skills.agents.search": "Tìm kiếm trợ lý",
  "marketplace.skills.agents.searchName": "Tìm các trợ lý có {name}",
  "marketplace.skills.agents.noMatch": "Không có trợ lý nào khớp với “{query}”.",
  "marketplace.skills.agents.removeAll": "Gỡ bỏ tất cả",
  "marketplace.skills.agents.removeAllName": {
    other: "Gỡ {name} khỏi {count} trợ lý",
  },
  "marketplace.skills.agent.toggle": "{name} cho {agent}",
  "marketplace.skills.agent.remove": "Gỡ bỏ",
  "marketplace.skills.agent.removeName": "Gỡ {name} khỏi {agent}",
  "marketplace.skills.add": "Thêm",
  "marketplace.skills.addName": "Thêm {name} vào trợ lý",
  "marketplace.skills.addToAgents": "Thêm vào trợ lý",
  "marketplace.skills.onOf": "Bật trên {have} trong {total}",
  "marketplace.skills.chooseAgents": "{name} đang bật trên {agents}. Chọn trợ lý",
  "marketplace.skills.dialog.list": "Trợ lý có {name}",
  "marketplace.skills.dialog.search": { other: "Tìm trong {count} trợ lý" },
  "marketplace.skills.dialog.all": { other: "Tất cả {count} trợ lý" },
  "marketplace.skills.dialog.allMatches": { other: "Tất cả {count} kết quả khớp" },
  "marketplace.skills.dialog.checked": "{checked} trong {total}",
  "marketplace.skills.dialog.save": "Lưu",
  "marketplace.skills.dialog.saveBoth": "Lưu: thêm {added}, gỡ bỏ {removed}",
  "marketplace.skills.dialog.addTo": "Thêm vào {agents}",
  "marketplace.skills.dialog.removeFrom": "Gỡ bỏ khỏi {agents}",
  "marketplace.skills.dialog.full": "Đã đạt giới hạn kỹ năng",
  "marketplace.skills.dialog.unread": "Kỹ năng chưa đọc",
  "marketplace.skills.local.gone": "Hiện không có trợ lý nào có kỹ năng này.",

  // Results that a screen reader hears. {agents} is a list of agent names.
  "marketplace.notice.agentAdded": "Đã thêm {name}.",
  "marketplace.notice.agentUpdated": "Đã cập nhật {name}.",
  "marketplace.notice.appConnected": "Đã kết nối {name}.",
  "marketplace.notice.appDisconnected": "Đã ngắt kết nối {name}.",
  "marketplace.notice.serverRemoved": "Đã gỡ bỏ {name}.",
  "marketplace.notice.skillInstalled": {
    other: "Đã cài đặt {name} trên {count} trợ lý.",
  },
  "marketplace.notice.skillRemoved": {
    other: "Đã gỡ {name} khỏi {count} trợ lý.",
  },
  "marketplace.error.skillPartial": "{name} không thay đổi trên các trợ lý này: {agents}. {reason}",

  // Errors. {reason} is an error message. {failures} is a list of error messages.
  "marketplace.error.openLink": "Không thể mở liên kết.",
  "marketplace.error.copyLink": "Không thể sao chép liên kết.",
  "marketplace.error.connectNoServer": "Hãy chọn một máy chủ cục bộ để kết nối ứng dụng này.",
  "marketplace.error.installNoServer": "Hãy chọn một máy chủ cục bộ để cài đặt một tiện ích.",
  "marketplace.error.installNoAgent": "Hãy chọn một trợ lý để cài đặt các kỹ năng của tiện ích này.",
  "marketplace.error.installLocalOnHost":
    "Cài đặt {name} trên máy tính chạy các trợ lý này: ứng dụng của nó chạy máy chủ trên máy tính đó.",
  "marketplace.error.installOnHost":
    "Cài đặt {name} trên máy tính chạy các trợ lý này: ứng dụng của nó cần đăng nhập qua trình duyệt.",
  "marketplace.error.appInvalid": "Không thể thêm {name}: {reason}",
  "marketplace.error.uninstallNoServer": "Hãy chọn một máy chủ cục bộ để gỡ cài đặt một tiện ích.",
  "marketplace.error.uninstallPartial": "Không thể gỡ bỏ một phần của {name}. {failures}",
  "marketplace.error.actionFailed": "Không thể hoàn tất thao tác trong cửa hàng. Hãy thử lại.",
  "marketplace.thisAgent": "trợ lý này",
} as const satisfies PartialTranslation<typeof source>;
