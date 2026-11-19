import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  "marketplace.category.coding": "Lập trình",
  "marketplace.category.design": "Thiết kế",
  "marketplace.category.dataAnalytics": "Dữ liệu & Phân tích",
  "marketplace.category.documents": "Tài liệu",
  "marketplace.category.productivity": "Năng suất",
  "marketplace.category.research": "Nghiên cứu",
  "marketplace.category.automation": "Tự động hóa",
  "marketplace.category.other": "Khác",
  "marketplace.loadFailed": "Không tải được Cửa hàng.",
  "marketplace.loading.skills": "Đang tải kỹ năng",
  "marketplace.loading.agents": "Đang tải agent",
  "marketplace.noMatch.skills": "Không có kỹ năng nào khớp với tìm kiếm này.",
  "marketplace.noMatch.agents": "Không có agent nào khớp với tìm kiếm này.",
  "marketplace.loadMore": "Tải thêm",
  "marketplace.version": "Phiên bản {version}",

  "marketplace.title": "Cửa hàng",
  "marketplace.kinds": "Các loại nội dung trong Cửa hàng",
  "marketplace.tab.agents": "Agent",
  "marketplace.tab.skills": "Kỹ năng",
  "marketplace.description.apps": "Kết nối các công cụ và dịch vụ mà agent của bạn làm việc cùng.",
  "marketplace.description.agents": "Agent dựng sẵn với hướng dẫn và kỹ năng riêng.",
  "marketplace.description.skills": "Hướng dẫn dạy agent một tác vụ hoặc một công cụ.",

  "marketplace.plugins.missing": "Plugin này không có trong danh mục của OpenBot.",

  "marketplace.agents.loadingDetail": "Đang tải chi tiết agent…",
  "marketplace.agents.skills": "Kỹ năng",
  "marketplace.agents.routines": "Tác vụ định kỳ",
  "marketplace.agents.routineInactive": "Không hoạt động",
  "marketplace.agents.by": "bởi {name}",
  "marketplace.agents.routineCount": { one: "{count} tác vụ định kỳ", other: "{count} tác vụ định kỳ" },
  "marketplace.agents.yours": "Agent của bạn",
  "marketplace.agents.all": "Tất cả agent",
  "marketplace.agents.missing": "Agent này không có trong Cửa hàng.",
  "marketplace.agents.trust.reviewed": "Do một người dùng OpenBot khác tạo. OpenBot đã xem xét trước khi phát hành.",
  "marketplace.agents.trust.reviewedBeforeAdd":
    "Do một người dùng OpenBot khác tạo. OpenBot đã xem xét trước khi phát hành. Sau khi thêm, agent có thể thay mặt bạn hành động.",
  "marketplace.agents.trust.pending": "Được người tạo chia sẻ trước khi OpenBot xem xét.",
  "marketplace.agents.trust.pendingBeforeAdd":
    "Được người tạo chia sẻ trước khi OpenBot xem xét. Sau khi thêm, agent có thể thay mặt bạn hành động.",
  "marketplace.agents.source.pending": "Chưa được xem xét",

  "marketplace.skill.loading": "Đang tải kỹ năng",
  "marketplace.try.readFailed": "OpenBot không đọc được kỹ năng của agent này. Hãy thử lại.",
  "marketplace.try.enable": "Hãy bật kỹ năng này trong cài đặt agent để dùng thử.",
  "marketplace.try.repair": "Hãy sửa kỹ năng này trong cài đặt agent để dùng thử.",
  "marketplace.try.update": "Hãy cập nhật kỹ năng này để dùng thử phiên bản này.",
  "marketplace.try.composerUnavailable": "Khung soạn tin của agent không khả dụng.",

  "marketplace.open": "Mở {name}",
  "marketplace.tab.apps": "Ứng dụng",
  "marketplace.crumbs.label": "Vị trí",
  "marketplace.search.label": "Tìm trong Cửa hàng",
  "marketplace.search.placeholder": "Tìm kiếm",
  "marketplace.installs": { one: "{installs} lượt cài đặt", other: "{installs} lượt cài đặt" },
  "marketplace.filter.clear": "Xóa bộ lọc",
  "marketplace.noMatch.apps": "Không có ứng dụng nào khớp với tìm kiếm này.",
  "marketplace.noMatch.filters": "Không có mục nào khớp với bộ lọc.",
  "marketplace.noMatch.showAgents": { one: "Hiện {count} agent", other: "Hiện {count} agent" },
  "marketplace.noMatch.showApps": { one: "Hiện {count} ứng dụng", other: "Hiện {count} ứng dụng" },
  "marketplace.noMatch.showSkills": { one: "Hiện {count} kỹ năng", other: "Hiện {count} kỹ năng" },
  "marketplace.empty.agents": "Cửa hàng chưa có agent nào.",
  "marketplace.empty.apps": "Cửa hàng chưa có ứng dụng nào.",
  "marketplace.empty.skills": "Cửa hàng chưa có kỹ năng nào.",
  "marketplace.properties.creator": "Người tạo",
  "marketplace.properties.category": "Danh mục",
  "marketplace.properties.version": "Phiên bản",
  "marketplace.properties.updated": "Cập nhật",
  "marketplace.properties.installs": "Lượt cài đặt",

  "marketplace.agent.add": "Thêm",
  "marketplace.agent.addNamed": "Thêm {name}",
  "marketplace.agent.addAgent": "Thêm agent",
  "marketplace.agent.added": "Đã thêm",
  "marketplace.agent.updateAvailable": "Có bản cập nhật",
  "marketplace.agent.update": "Cập nhật",
  "marketplace.agent.openChat": "Mở cuộc trò chuyện",

  "marketplace.agentUpdate.title": "Cập nhật {name}?",
  "marketplace.agentUpdate.body": {
    one: "{count} kỹ năng có thay đổi cục bộ. Kỹ năng này được giữ nguyên trừ khi bạn chọn Thay thế.",
    other: "{count} kỹ năng có thay đổi cục bộ. Các kỹ năng này được giữ nguyên trừ khi bạn chọn Thay thế.",
  },
  "marketplace.agentUpdate.listLabel": "Kỹ năng có thay đổi cục bộ",
  "marketplace.agentUpdate.keep": "Giữ thay đổi của bạn",
  "marketplace.agentUpdate.lost": "Thay đổi của bạn sẽ bị mất",
  "marketplace.agentUpdate.choiceLabel": "Giữ hoặc thay thế {name}",
  "marketplace.agentUpdate.keepOption": "Giữ",
  "marketplace.agentUpdate.replace": "Thay thế",
  "marketplace.agentUpdate.others": {
    one: "{count} kỹ năng khác cũng được cập nhật.",
    other: "{count} kỹ năng khác cũng được cập nhật.",
  },
  "marketplace.agentUpdate.confirm": "Cập nhật agent",

  "marketplace.app.connect": "Kết nối",
  "marketplace.app.reconnect": "Kết nối lại",
  "marketplace.app.connectNamed": "Kết nối {name}",
  "marketplace.app.reconnectNamed": "Kết nối lại {name}",
  "marketplace.app.connected": "Đã kết nối",
  "marketplace.app.attention": "Cần chú ý",
  "marketplace.app.partialTitle": "{name} chưa hoàn chỉnh",
  "marketplace.app.partialDescription":
    "Một số ứng dụng hoặc kỹ năng của plugin này chưa được cài đặt. Kết nối lại sẽ cài đặt chúng.",
  "marketplace.app.notConnected": "Chưa kết nối",
  "marketplace.app.paused": "Đã tạm dừng",
  "marketplace.app.custom": "Máy chủ MCP",
  "marketplace.app.githubTagline": "Kho mã, issue và pull request",
  "marketplace.app.onePasswordTagline": "Đăng nhập vào trang web bằng thông tin đăng nhập bạn chia sẻ",
  "marketplace.app.slackTagline": "Lượt nhắc và tin nhắn trực tiếp trong Slack",
  "marketplace.app.discordTagline": "Lượt nhắc và tin nhắn trực tiếp trong Discord",
  "marketplace.app.telegramTagline": "Nhóm và cuộc trò chuyện trực tiếp trong Telegram",
  "marketplace.app.whatsappTagline": "Cuộc trò chuyện của riêng bạn và những người bạn cho phép trong WhatsApp",
  "marketplace.app.bitwardenTagline": "Đăng nhập vào trang web bằng thông tin đăng nhập từ một thư mục được chia sẻ",
  "marketplace.app.protonPassTagline": "Đăng nhập vào trang web bằng thông tin đăng nhập từ một vault được chia sẻ",
  "marketplace.app.onePasswordCategory": "Quản lý đăng nhập và thông tin xác thực",
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
  "marketplace.app.remove.description":
    "Agent của bạn sẽ không thể dùng máy chủ này nữa. Cài đặt của máy chủ sẽ bị xóa.",
  "marketplace.app.remove.action": "Gỡ",
  "marketplace.app.remove.confirmTitle": "Gỡ {name}?",
  "marketplace.app.remove.keep": "Giữ",
  "marketplace.app.replace.title": "Thay thế {server}?",
  "marketplace.app.replace.description":
    "Bạn đã có một máy chủ tên {server}, nhưng đó không phải là {name}. Thay thế bằng {name}? Địa chỉ và các khóa đã lưu của máy chủ đó sẽ bị xóa.",
  "marketplace.app.replace.action": "Thay thế",
  "marketplace.app.connection": "Kết nối",
  "marketplace.app.access.use": "Có thể dùng",
  "marketplace.app.access.noAgents": "Không có agent",
  "marketplace.app.access.agentsOf": "Agent có thể dùng {name}",
  "marketplace.app.access.chooseAgents": "{name}: {summary}. Chọn agent",
  "marketplace.app.access.level": "Quyền truy cập của {role} vào {name}",
  "marketplace.app.setup.account": "Đăng nhập bằng tài khoản {name} của bạn trên trình duyệt.",
  "marketplace.app.setup.key": "Cần khóa API từ tài khoản {name} của bạn.",
  "marketplace.app.setup.keySaved": "Đã lưu {field} trên {host}.",
  "marketplace.app.account.removeDescription": "OpenBot xóa thông tin đăng nhập của tài khoản này trên {host}.",
  "marketplace.app.setup.desktop": "Chạy trong ứng dụng máy tính {name} tại {address}.",
  "marketplace.app.setup.desktopConnected": "Đã kết nối với {address}.",
  "marketplace.app.setup.open": "Không cần đăng nhập hay khóa.",
  "marketplace.app.blocked.update":
    "{host} chạy phiên bản OpenBot cũ không thể kết nối ứng dụng. Hãy cập nhật OpenBot trên {host}, hoặc nhờ chủ sở hữu cập nhật.",
  "marketplace.app.blocked.member":
    "Chỉ chủ sở hữu hoặc quản trị viên của {host} mới có thể kết nối ứng dụng tại đó. Hãy nhờ một trong số họ kết nối {name}, hoặc cập nhật OpenBot trên {host} để thành viên có thể kết nối ứng dụng.",
  "marketplace.app.blocked.mac": "{name} chỉ hoạt động trên máy Mac chạy OpenBot.",
  "marketplace.app.connectAgain": "Kết nối lại",
  "marketplace.app.automation.askOnInstall": "Xin quyền truy cập từ macOS khi cài đặt",
  "marketplace.app.automation.title": "Quyền truy cập ứng dụng Apple",
  "marketplace.app.automation.description":
    "macOS hiển thị một lời nhắc cho mỗi ứng dụng. Ứng dụng đang đóng sẽ mở trong giây lát, rồi thoát.",
  "marketplace.app.automation.request": "Xin quyền truy cập",
  "marketplace.app.automation.allowed": "Giờ đây OpenBot có thể điều khiển tất cả ứng dụng Apple.",
  "marketplace.app.automation.refused":
    "macOS chưa cấp quyền truy cập cho {apps}. Hãy cho phép OpenBot trong Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Tự động hóa.",
  "marketplace.app.automation.failed": "OpenBot không hỏi được macOS về {apps}. Hãy thử lại.",
  "marketplace.app.automation.app.calendar": "Lịch",
  "marketplace.app.automation.app.contacts": "Danh bạ",
  "marketplace.app.automation.app.mail": "Mail",
  "marketplace.app.automation.app.notes": "Ghi chú",
  "marketplace.app.automation.app.reminders": "Lời nhắc",
  "marketplace.app.automation.app.messages": "Tin nhắn",
  "marketplace.app.automation.app.safari": "Safari",
  "marketplace.app.signInTitle": "Đăng nhập lại vào {name}",
  "marketplace.app.signInDescription":
    "{name} đã từ chối thông tin đăng nhập đã lưu. Agent của bạn không thể dùng ứng dụng này cho đến khi bạn đăng nhập lại.",

  "marketplace.plugin.aave.tagline": "Dữ liệu và giao dịch Aave",
  "marketplace.plugin.aave.description":
    "Aave giúp người dùng khám phá các thị trường Aave V3 và V4 theo thời gian thực, xem vị thế ví và quản trị DAO, mô phỏng các thao tác cho vay và chuẩn bị giao dịch phi lưu ký. Mọi giao dịch đều được trả về ở dạng chưa ký: plugin đọc thị trường và soạn lệnh gọi, còn ví vẫn do người dùng giữ.",
  "marketplace.plugin.aave.app":
    "Thị trường V3 và V4 theo thời gian thực, vị thế ví, quản trị DAO và giao dịch đã chuẩn bị, qua một máy chủ MCP.",
  "marketplace.plugin.aave.prompt.stablecoinYield":
    "Hiện tại tôi có thể kiếm lời nhiều nhất từ stablecoin ở đâu trên Aave?",
  "marketplace.plugin.aave.prompt.usdcRates": "Hiện tại Aave V3 hay V4 trên Ethereum trả lãi USDC cao hơn?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "Health factor của 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c là bao nhiêu, và còn cách mức thanh lý bao xa?",
  "marketplace.plugin.canva.tagline": "Thiết kế, tài sản và xuất tệp",
  "marketplace.plugin.canva.description":
    "Canva cho phép người dùng tạo và chỉnh sửa thiết kế bằng lời, tìm trong thư viện thiết kế của mình, tải lên và sắp xếp tài sản, xuất theo định dạng mà từng kênh cần và để lại bình luận ngay tại thiết kế. Mỗi người dùng đăng nhập vào tài khoản Canva của riêng mình, và agent có thể làm những gì tài khoản đó làm được.",
  "marketplace.plugin.canva.app":
    "Tạo và chỉnh sửa thiết kế, tìm trong thư viện, quản lý tài sản và thương hiệu, xuất tệp và bình luận, qua một máy chủ MCP.",
  "marketplace.plugin.canva.prompt.recentDesign": "Cho tôi xem thiết kế Canva tôi chỉnh sửa gần đây nhất.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Đổi kích thước poster ra mắt của tôi cho Instagram và xuất cả hai bản dưới dạng PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "Biến ghi chú phát hành này thành một bản trình bày Canva sáu trang.",
  "marketplace.plugin.linear.tagline": "Issue và phân loại dự án",
  "marketplace.plugin.linear.description":
    "Linear cho phép agent liệt kê các issue được giao, phân loại backlog, cập nhật trạng thái và soạn issue mới trong không gian làm việc của tài khoản đã đăng nhập. Mỗi người dùng đăng nhập vào tài khoản Linear của riêng mình qua trình duyệt.",
  "marketplace.plugin.linear.app":
    "Tìm issue, phân loại, cập nhật trạng thái và tạo issue, qua máy chủ MCP của Linear với đăng nhập trên trình duyệt.",
  "marketplace.plugin.linear.prompt.myWeek": "Tuần này tôi được giao những gì?",
  "marketplace.plugin.linear.prompt.backlog": "Phân loại backlog: mục nào đã cũ, bị chặn hoặc chưa có người phụ trách?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Tạo một issue cho lỗi crash trong hàng đợi đồng bộ, kèm các bước tái hiện.",
  "marketplace.plugin.notion.tagline": "Tài liệu và cơ sở tri thức",
  "marketplace.plugin.notion.description":
    "Notion cho phép agent đọc và viết trang, tìm trong không gian làm việc, và lưu ghi chú cuộc họp cùng đặc tả ngay nơi nhóm đang làm việc. Mỗi người dùng đăng nhập vào tài khoản Notion của riêng mình qua trình duyệt.",
  "marketplace.plugin.notion.app":
    "Tìm, đọc, viết trang và điều hướng không gian làm việc, qua máy chủ MCP của Notion với đăng nhập trên trình duyệt.",
  "marketplace.plugin.notion.prompt.findSpec": "Tìm đặc tả ra mắt hiện tại và tóm tắt các câu hỏi còn mở.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Biến các gạch đầu dòng này thành một ghi chú cuộc họp có cấu trúc trong không gian nhóm của tôi.",
  "marketplace.plugin.notion.prompt.updateDoc":
    "Cập nhật tài liệu hướng dẫn người mới với danh sách kiểm tra phát hành mới.",
  "marketplace.plugin.cobrain.tagline": "Bộ nhớ chung cho các agent AI của bạn",
  "marketplace.plugin.cobrain.description":
    "Cobrain là bộ nhớ dạng Markdown mà mọi AI bạn kết nối đều có thể đọc và ghi. Agent tải ngữ cảnh của một khách hàng hoặc dự án trước khi làm việc, tìm các ghi chú và quyết định trước đây, và lưu những gì học được để luồng tiếp theo bắt đầu từ nơi luồng trước kết thúc. Mỗi người dùng đăng nhập vào tài khoản Cobrain của riêng mình.",
  "marketplace.plugin.cobrain.app": "Đọc, tìm và viết ghi chú trong bộ não Cobrain của bạn qua một máy chủ MCP.",
  "marketplace.plugin.cobrain.prompt.startSession": "Tải ngữ cảnh Cobrain của tôi cho dự án này trước khi bắt đầu.",
  "marketplace.plugin.cobrain.prompt.searchDecision":
    "Tìm trong ghi chú Cobrain của tôi xem chúng ta đã quyết định gì về giá.",
  "marketplace.plugin.cobrain.prompt.saveNote":
    "Lưu một ghi chú trong Cobrain về những gì chúng ta đã làm hôm nay và những gì còn lại.",
  "marketplace.plugin.honcho.tagline": "Bộ nhớ của bạn trên các công cụ AI",
  "marketplace.plugin.honcho.description":
    "Honcho của Plastic Labs cung cấp cho agent bộ nhớ dài hạn về bạn, có thể chia sẻ với các công cụ AI khác mà bạn kết nối. Agent lưu những gì học được, và Honcho suy luận trên đó để xây dựng mô hình về sở thích, mục tiêu và cách làm việc của bạn. Agent đặt câu hỏi cho Honcho trước khi bắt đầu. Agent OpenBot cũng có bộ nhớ riêng; Honcho là bộ nhớ đi theo bạn sang các công cụ khác. Tin nhắn mà agent lưu sẽ được gửi đến tài khoản Honcho của bạn.",
  "marketplace.plugin.honcho.app":
    "Lưu và truy vấn bộ nhớ dài hạn trong các không gian làm việc Honcho của bạn qua một máy chủ MCP.",
  "marketplace.plugin.honcho.prompt.recall": "Hỏi Honcho xem nó biết gì về cách tôi thích làm việc trước khi bắt đầu.",
  "marketplace.plugin.honcho.prompt.save": "Lưu các quyết định từ luồng này vào Honcho.",
  "marketplace.plugin.honcho.prompt.preferences": "Honcho nói gì về văn phong của tôi? Hãy dùng nó cho bản nháp này.",
  "marketplace.plugin.honcho.hint.apiKey": "Tạo khóa tại app.honcho.dev.",
  "marketplace.plugin.hindsight.tagline": "Bộ nhớ học hỏi theo thời gian",
  "marketplace.plugin.hindsight.description":
    "Hindsight của Vectorize cung cấp cho agent bộ nhớ dài hạn trong Hindsight Cloud. Agent ghi nhớ sự kiện và dữ kiện, gợi lại chúng theo ý nghĩa, thời gian và thực thể, và suy ngẫm về chúng để hình thành mô hình tư duy. Ký ức được lưu trong các bank, và agent có thể tạo một bank cho mỗi dự án hoặc mỗi người. Agent OpenBot cũng có bộ nhớ riêng; Hindsight là bộ nhớ mà các công cụ AI khác bạn kết nối có thể chia sẻ. Những gì agent ghi nhớ sẽ được gửi đến tài khoản Hindsight Cloud của bạn.",
  "marketplace.plugin.hindsight.app":
    "Ghi nhớ, gợi lại và suy ngẫm về ký ức trong các bank Hindsight Cloud của bạn qua một máy chủ MCP.",
  "marketplace.plugin.hindsight.prompt.recall":
    "Gợi lại từ Hindsight những gì chúng ta biết về dự án này trước khi bắt đầu.",
  "marketplace.plugin.hindsight.prompt.retain": "Ghi nhớ các quyết định và câu hỏi còn mở từ luồng này vào Hindsight.",
  "marketplace.plugin.hindsight.prompt.reflect":
    "Suy ngẫm về ký ức Hindsight của tôi: bạn thấy những khuôn mẫu nào trong công việc tháng vừa qua của tôi?",
  "marketplace.plugin.hindsight.hint.apiKey": "Tạo khóa trên trang Connect của Hindsight Cloud.",
  "marketplace.plugin.figma.tagline": "Thiết kế và prototype",
  "marketplace.plugin.figma.description":
    "Figma cho phép agent đọc tệp thiết kế, kiểm tra component, style và biến, và bàn giao đặc tả sản xuất cho kỹ sư. Plugin kết nối với máy chủ MCP trong ứng dụng Figma desktop trên máy tính này. Máy chủ chỉ đọc được thiết kế; tính năng ghi đang được phát triển.",
  "marketplace.plugin.figma.app":
    "Ngữ cảnh thiết kế, siêu dữ liệu, biến và ảnh chụp màn hình, qua máy chủ MCP trong ứng dụng Figma desktop. Hiện chỉ đọc.",
  "marketplace.plugin.figma.prompt.handoff": "Bàn giao tệp checkout: liệt kê màn hình, component và style.",
  "marketplace.plugin.figma.prompt.audit":
    "Kiểm tra tệp này xem khoảng cách và màu sắc có được dùng không nhất quán không.",
  "marketplace.plugin.figma.prompt.assets": "Xuất các biểu tượng marketing ở kích thước 2x cho gói ứng dụng.",
  "marketplace.plugin.paper.tagline": "Canvas thiết kế xây dựng trên HTML và CSS",
  "marketplace.plugin.paper.description":
    "Paper cho phép agent đọc và ghi tệp thiết kế đang mở trong Paper Desktop: kiểm tra artboard, vùng chọn, style đã tính, JSX và token, cũng như tạo hoặc thay đổi frame, văn bản và style. Hãy cài đặt Paper Desktop, mở ứng dụng một lần và mở một tệp trước khi bắt đầu. OpenBot khởi động Paper CLI do Paper Desktop cài đặt. Paper không cần khóa. Các công cụ ghi sẽ thay đổi tệp đang mở, vì vậy hãy xem lại từng thao tác ghi trước khi chấp thuận.",
  "marketplace.plugin.paper.app":
    "Đọc và ghi tệp Paper Desktop đang mở, qua máy chủ MCP cục bộ do Paper CLI chuyển tiếp. Cần Paper Desktop đang mở một tệp.",
  "marketplace.plugin.paper.prompt.implement":
    "Hiện thực frame Paper đã chọn trong codebase này, theo quy ước mã của chúng ta.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Dùng các style trong kho mã này và thiết kế một trang cài đặt trong Paper.",
  "marketplace.plugin.paper.prompt.tokens":
    "Liệt kê các design token trong tệp Paper đang mở và so sánh với theme của chúng ta.",
  "marketplace.plugin.higgsfield.tagline": "Hình ảnh, video và âm thanh AI",
  "marketplace.plugin.higgsfield.description":
    "Higgsfield cho phép agent tạo hình ảnh, video, nhân vật và âm thanh bằng các mô hình Higgsfield như Seedance, Kling, Veo và MiniMax Hailuo, kiểm tra số dư credit và duyệt Asset Library. Kết quả được lưu vào Higgsfield Assets của người dùng. Mỗi người dùng đăng nhập vào tài khoản Higgsfield của riêng mình qua trình duyệt. Mỗi lần tạo đều dùng credit của tài khoản đó theo mức giá tiêu chuẩn, kể cả trên gói không giới hạn.",
  "marketplace.plugin.higgsfield.app":
    "Tạo hình ảnh, video và âm thanh, nhân vật, credit và tài sản, qua máy chủ MCP của Higgsfield với đăng nhập trên trình duyệt.",
  "marketplace.plugin.higgsfield.prompt.credits": "Tôi còn bao nhiêu credit Higgsfield?",
  "marketplace.plugin.higgsfield.prompt.productShot": "Tạo một ảnh sản phẩm Higgsfield về chiếc cốc gốm trên bàn gỗ.",
  "marketplace.plugin.higgsfield.prompt.clip": "Tạo một video Higgsfield dài 5 giây về sóng biển lúc hoàng hôn.",
  "marketplace.plugin.sunra.tagline": "Hình ảnh, video, âm thanh và 3D bằng AI",
  "marketplace.plugin.sunra.description":
    "Sunra cho phép agent tạo hình ảnh, video, âm thanh và mô hình 3D bằng các mô hình như GPT Image, Nano Banana, Seedream, FLUX, Seedance, Kling và Veo, kiểm tra số dư credit và đọc kết quả. Kết quả được đưa vào một dự án trong tài khoản Sunra của người dùng. Mỗi người dùng đăng nhập vào tài khoản Sunra của riêng mình qua trình duyệt. Sunra báo giá trước cho mỗi lần tạo, và chỉ dùng credit của tài khoản đó sau khi được xác nhận.",
  "marketplace.plugin.sunra.app":
    "Tạo hình ảnh, video, âm thanh và 3D, credit và kết quả, qua máy chủ MCP của Sunra với đăng nhập trên trình duyệt.",
  "marketplace.plugin.sunra.prompt.balance": "Tôi còn bao nhiêu credit Sunra?",
  "marketplace.plugin.sunra.prompt.poster": "Tạo một poster Sunra về chợ đêm trong mưa, khổ dọc.",
  "marketplace.plugin.sunra.prompt.clip":
    "Tạo một video Sunra dài 5 giây về chiếc thuyền giấy trên sông. Hãy cho tôi biết chi phí trước.",
  "marketplace.plugin.elevenlabs.tagline": "Giọng nói, giọng đọc và voice agent",
  "marketplace.plugin.elevenlabs.description":
    "ElevenLabs cho phép agent chuyển văn bản thành giọng nói, làm việc với giọng đọc, và tạo, thử nghiệm, xem lại các voice agent ElevenLabs cùng cuộc trò chuyện của chúng. Âm thanh được tạo sẽ trả về dưới dạng liên kết tải xuống có thời hạn ngắn. Mỗi người dùng đăng nhập vào tài khoản ElevenLabs của riêng mình qua trình duyệt, và mỗi lần tạo đều dùng credit của tài khoản đó.",
  "marketplace.plugin.elevenlabs.app":
    "Chuyển văn bản thành giọng nói, giọng đọc và quản lý voice agent, qua máy chủ MCP của ElevenLabs với đăng nhập trên trình duyệt.",
  "marketplace.plugin.elevenlabs.prompt.speech":
    "Đọc to đoạn văn này bằng một giọng ElevenLabs điềm tĩnh và gửi tôi tệp âm thanh.",
  "marketplace.plugin.elevenlabs.prompt.agents":
    "Liệt kê các voice agent ElevenLabs của tôi và giọng đọc mà mỗi agent dùng.",
  "marketplace.plugin.elevenlabs.prompt.conversations":
    "Tóm tắt mười cuộc trò chuyện gần nhất của voice agent hỗ trợ của tôi.",
  "marketplace.plugin.appleApps.tagline": "Mail, Lịch và nhiều ứng dụng khác trên máy Mac của bạn",
  "marketplace.plugin.appleApps.description":
    "Ứng dụng Apple cho phép agent dùng Mail, Lịch, Danh bạ, Lời nhắc, Ghi chú, Tin nhắn và Safari trên máy Mac này. Plugin chỉ hoạt động trên macOS. OpenBot khởi động mcp-icloud, một máy chủ cộng đồng không do Apple hay OpenBot phát triển. Máy chủ điều khiển các ứng dụng qua AppleScript trên máy tính này, không cần tài khoản hay khóa. Khi bạn cài đặt, OpenBot có thể xin macOS quyền truy cập tất cả ứng dụng này cùng lúc, với một lời nhắc cho mỗi ứng dụng. Nếu bạn không làm vậy, macOS sẽ hỏi vào lần đầu agent dùng một ứng dụng. Để thay đổi sau này, hãy mở Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Tự động hóa. Agent có thể gửi email và iMessage, cũng như thay đổi hoặc xóa sự kiện, liên hệ và lời nhắc, vì vậy hãy xem lại từng thao tác ghi trước khi chấp thuận. Những gì công cụ đọc được, chẳng hạn nội dung email, sẽ được gửi đến nhà cung cấp mô hình của agent.",
  "marketplace.plugin.appleApps.app":
    "Mail, Lịch, Danh bạ, Lời nhắc, Ghi chú, Tin nhắn và Safari, qua máy chủ mcp-icloud cục bộ. Cần macOS và quyền Tự động hóa.",
  "marketplace.plugin.appleApps.prompt.unread": "Tóm tắt các email chưa đọc hôm nay trong Apple Mail của tôi.",
  "marketplace.plugin.appleApps.prompt.today": "Lịch Apple của tôi có gì hôm nay và ngày mai?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Tìm email mới nhất về cuộc họp dự án và thêm cuộc họp vào lịch của tôi.",
  "marketplace.plugin.sentry.tagline": "Phân loại lỗi và crash",
  "marketplace.plugin.sentry.description":
    "Sentry cho phép agent tìm các lỗi gần đây, kiểm tra stack trace và các bản phát hành bị ảnh hưởng, và tóm tắt những gì bị hỏng sau một lần triển khai. Mỗi người dùng đăng nhập vào tài khoản Sentry của riêng mình qua trình duyệt.",
  "marketplace.plugin.sentry.app":
    "Tìm lỗi, kiểm tra issue và tình trạng bản phát hành, qua máy chủ MCP của Sentry với đăng nhập trên trình duyệt.",
  "marketplace.plugin.sentry.prompt.newErrors": "Những lỗi mới nào đã xuất hiện kể từ lần triển khai hôm qua?",
  "marketplace.plugin.sentry.prompt.topCrash":
    "Giải thích crash phổ biến nhất trong dự án di động và nguyên nhân có thể.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Bản phát hành hiện tại ổn định đến đâu so với bản trước?",
  "marketplace.plugin.gitlab.tagline": "Issue, merge request và pipeline",
  "marketplace.plugin.gitlab.description":
    "GitLab cho phép agent tìm dự án, đọc và tạo issue, xem xét và cập nhật merge request, đọc tệp và commit trong kho mã, và kiểm tra pipeline cùng job CI trên GitLab.com. Mỗi người dùng đăng nhập vào tài khoản GitLab của riêng mình qua trình duyệt. Agent có cùng quyền như người dùng: có thể push commit, thay đổi issue và merge request, và merge chúng. Với GitLab tự lưu trữ, hãy thêm một máy chủ MCP với địa chỉ GitLab của bạn, theo sau là /api/v4/mcp, trong phần cài đặt máy chủ MCP, rồi đăng nhập tại đó.",
  "marketplace.plugin.gitlab.app":
    "Dự án, issue, merge request, kho mã và pipeline CI, qua máy chủ MCP của GitLab với đăng nhập trên trình duyệt.",
  "marketplace.plugin.gitlab.prompt.reviewQueue": "Những merge request nào đang chờ tôi xem xét?",
  "marketplace.plugin.gitlab.prompt.failedPipeline": "Vì sao pipeline gần nhất trên nhánh mặc định bị lỗi?",
  "marketplace.plugin.gitlab.prompt.newIssue":
    "Tạo một issue cho lỗi crash trong hàng đợi đồng bộ, kèm các bước tái hiện.",
  "marketplace.plugin.vercel.tagline": "Bản triển khai, nhật ký build và dự án",
  "marketplace.plugin.vercel.description":
    "Vercel cho phép agent liệt kê dự án và các bản triển khai gần đây, đọc nhật ký build và runtime, và tìm lý do build bị lỗi. Mỗi người dùng đăng nhập vào tài khoản Vercel của riêng mình qua trình duyệt và chọn các team mà agent có thể dùng. Trong các team đó, agent có cùng quyền như tài khoản của người dùng. Agent cũng có thể thay đổi biến môi trường, tên miền, bản ghi DNS và bản triển khai, cũng như mua tên miền.",
  "marketplace.plugin.vercel.app":
    "Dự án, bản triển khai, nhật ký build và nhật ký runtime, qua máy chủ MCP của Vercel với đăng nhập trên trình duyệt.",
  "marketplace.plugin.vercel.prompt.failedBuild": "Vì sao bản triển khai production gần nhất bị lỗi?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "Liệt kê các bản triển khai hôm nay và trạng thái của chúng.",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "Những route nào gặp lỗi runtime trong một giờ qua?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, lưu trữ và nhật ký",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare cho phép agent liệt kê và quản lý Workers, bản ghi DNS, R2, D1 và KV qua Cloudflare API, truy vấn nhật ký Workers và tìm trong tài liệu Cloudflare. Mỗi người dùng đăng nhập vào tài khoản Cloudflare của riêng mình qua trình duyệt. Trên trang đồng ý của Cloudflare, hãy chọn Read only: tùy chọn mặc định, Minimal, không cho agent xem Workers, nhật ký hay bản ghi DNS. Với quyền ghi, agent có thể triển khai và xóa Workers, thay đổi bản ghi DNS và các cài đặt tài khoản khác.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, lưu trữ và nhật ký, qua máy chủ API MCP của Cloudflare với đăng nhập trên trình duyệt.",
  "marketplace.plugin.cloudflare.prompt.workers":
    "Những Workers nào đã được triển khai trong tài khoản Cloudflare của tôi?",
  "marketplace.plugin.cloudflare.prompt.errors": "Những Cloudflare Workers nào ghi nhận lỗi trong một giờ qua?",
  "marketplace.plugin.cloudflare.prompt.dns":
    "Liệt kê các bản ghi DNS của từng zone trong tài khoản Cloudflare của tôi.",
  "marketplace.plugin.supabase.tagline": "Cơ sở dữ liệu, nhật ký và edge function",
  "marketplace.plugin.supabase.description":
    "Supabase cho phép agent liệt kê dự án, chạy SQL, đọc schema bảng và nhật ký, xem các advisor về bảo mật và hiệu năng, quản lý edge function và nhánh, và tìm trong tài liệu Supabase. Mỗi người dùng đăng nhập vào tài khoản Supabase của riêng mình qua trình duyệt và chọn một tổ chức. Agent có toàn quyền truy cập: có thể chạy SQL làm thay đổi hoặc xóa dữ liệu, áp dụng migration, triển khai edge function, và tạo hoặc tạm dừng dự án.",
  "marketplace.plugin.supabase.app":
    "Cơ sở dữ liệu, nhật ký và edge function, qua máy chủ MCP của Supabase với đăng nhập trên trình duyệt.",
  "marketplace.plugin.supabase.prompt.projects": "Tổ chức Supabase của tôi có những dự án nào?",
  "marketplace.plugin.supabase.prompt.tables": "Liệt kê các bảng và cột trong cơ sở dữ liệu Supabase của tôi.",
  "marketplace.plugin.supabase.prompt.errors": "Dự án Supabase của tôi đã ghi nhận những lỗi nào trong một giờ qua?",
  "marketplace.plugin.context7.tagline": "Tài liệu thư viện mới nhất",
  "marketplace.plugin.context7.description":
    "Context7 lấy tài liệu và tham chiếu API mới nhất của các thư viện và framework, để câu trả lời dùng đúng phiên bản mà dự án đang chạy. Không cần tài khoản hay khóa.",
  "marketplace.plugin.context7.app":
    "Tra cứu tài liệu thư viện mới nhất, qua máy chủ MCP Context7, không cần đăng nhập.",
  "marketplace.plugin.context7.prompt.apiCheck": "API hiện tại cho danh sách ảo hóa trong framework này là gì?",
  "marketplace.plugin.context7.prompt.migrate": "Router này đã thay đổi những gì giữa v2 và v3?",
  "marketplace.plugin.context7.prompt.example": "Cho tôi xem một ví dụ mới nhất về tải tệp lên có xác thực.",
  "marketplace.plugin.stripe.tagline": "Xem xét thanh toán và hóa đơn",
  "marketplace.plugin.stripe.description":
    "Stripe cho phép agent tra cứu thanh toán, khách hàng và hóa đơn, và soạn liên kết thanh toán, trong tài khoản mà người dùng đã đăng nhập có quyền truy cập. Mỗi người dùng đăng nhập vào tài khoản Stripe của riêng mình qua trình duyệt.",
  "marketplace.plugin.stripe.app":
    "Tra cứu thanh toán, khách hàng và hóa đơn, qua máy chủ MCP của Stripe với đăng nhập trên trình duyệt.",
  "marketplace.plugin.stripe.prompt.payment": "Tra cứu khoản thanh toán này và giải thích vì sao nó thất bại.",
  "marketplace.plugin.stripe.prompt.customer": "Tóm tắt các hóa đơn và số dư chưa thanh toán của khách hàng này.",
  "marketplace.plugin.stripe.prompt.link": "Soạn một liên kết thanh toán cho gói Pro với giá 49 mỗi tháng.",
  "marketplace.plugin.revenuecat.tagline": "Gói đăng ký, sản phẩm và paywall",
  "marketplace.plugin.revenuecat.description":
    "RevenueCat cho phép agent đọc và thay đổi thiết lập gói đăng ký trong ứng dụng của bạn: ứng dụng, sản phẩm, entitlement, offering, package, paywall và thử nghiệm. Agent cũng có thể tra cứu khách hàng và giao dịch mua của họ, và đọc biểu đồ cùng chỉ số. Khóa API bí mật của RevenueCat được đặt trong một header Authorization. Khóa chỉ truy cập được một dự án. Với khóa chỉ đọc, agent chỉ có thể đọc. Với khóa ghi, agent có thể gửi sản phẩm lên App Store để xét duyệt, cấp entitlement cho khách hàng, và xóa package, quy tắc nhắm mục tiêu và webhook.",
  "marketplace.plugin.revenuecat.app":
    "Sản phẩm, entitlement, offering, paywall và chỉ số, qua máy chủ MCP của RevenueCat với khóa API bí mật.",
  "marketplace.plugin.revenuecat.prompt.offerings": "Dự án RevenueCat của tôi có những offering và package nào?",
  "marketplace.plugin.revenuecat.prompt.revenue":
    "Doanh thu và số gói đăng ký đang hoạt động trên RevenueCat của tôi đã thay đổi thế nào trong tháng này?",
  "marketplace.plugin.revenuecat.prompt.customer":
    "Khách hàng RevenueCat này có những entitlement nào, và khi nào chúng hết hạn?",
  "marketplace.plugin.revenuecat.hint.apiKey":
    "Trong bảng điều khiển RevenueCat, hãy mở API keys trong dự án của bạn và tạo một khóa API bí mật. Khóa chỉ đọc là đủ để xem dữ liệu.",
  "marketplace.plugin.posthog.tagline": "Phân tích sản phẩm và feature flag",
  "marketplace.plugin.posthog.description":
    "PostHog cho phép agent truy vấn sự kiện và phễu, kiểm tra feature flag và tóm tắt những gì đã thay đổi sau một bản phát hành. Khóa API cá nhân từ cài đặt dự án được đặt trong một header Authorization.",
  "marketplace.plugin.posthog.app":
    "Truy cập sự kiện, phễu và feature flag, qua máy chủ MCP của PostHog với khóa API cá nhân.",
  "marketplace.plugin.posthog.prompt.funnel": "Phễu đăng ký trong 14 ngày qua trông thế nào?",
  "marketplace.plugin.posthog.prompt.flag": "Những feature flag nào đang bật cho người dùng này?",
  "marketplace.plugin.posthog.prompt.release": "Tỷ lệ kích hoạt có thay đổi sau bản phát hành tuần trước không?",
  "marketplace.plugin.airtable.tagline": "Base và bản ghi",
  "marketplace.plugin.airtable.description":
    "Airtable cho phép agent liệt kê base, đọc và cập nhật bản ghi, và tóm tắt nội dung bảng. Khóa API từ trang tài khoản được truyền cho máy chủ cục bộ dưới dạng một biến môi trường.",
  "marketplace.plugin.airtable.app": "Liệt kê base và truy cập bản ghi, qua máy chủ MCP cục bộ với khóa API Airtable.",
  "marketplace.plugin.airtable.prompt.bases": "Tôi có quyền truy cập những base nào?",
  "marketplace.plugin.airtable.prompt.records": "Tóm tắt bảng theo dõi ra mắt.",
  "marketplace.plugin.airtable.prompt.update": "Đánh dấu các tính năng đã phát hành là hoàn tất trong base lộ trình.",
  "marketplace.plugin.firecrawl.tagline": "Trích xuất và tìm kiếm web",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl cho phép agent thu thập trang, trích xuất dữ liệu có cấu trúc và tìm kiếm web qua một API. Khóa API từ bảng điều khiển Firecrawl được truyền cho máy chủ cục bộ dưới dạng một biến môi trường.",
  "marketplace.plugin.firecrawl.app":
    "Thu thập trang, trích xuất và tìm kiếm web, qua máy chủ MCP cục bộ với khóa API Firecrawl.",
  "marketplace.plugin.firecrawl.prompt.scrape": "Trích xuất bảng giá từ trang này dưới dạng dữ liệu có cấu trúc.",
  "marketplace.plugin.firecrawl.prompt.research": "Nghiên cứu giá của đối thủ và trích dẫn từng trang nguồn.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Trang changelog của chúng ta đã thay đổi gì trong tháng này?",
  "marketplace.plugin.braveSearch.tagline": "Tìm kiếm web riêng tư",
  "marketplace.plugin.braveSearch.description":
    "Brave Search cho phép agent tìm kiếm web và kết quả địa phương mà không bị theo dõi. Khóa API từ bảng điều khiển Brave Search API được truyền cho máy chủ cục bộ dưới dạng một biến môi trường.",
  "marketplace.plugin.braveSearch.app": "Tìm kiếm web và địa phương, qua máy chủ MCP cục bộ với khóa API Brave.",
  "marketplace.plugin.braveSearch.prompt.search": "Người đánh giá nói gì về phiên bản framework này?",
  "marketplace.plugin.braveSearch.prompt.news": "Tìm các thông báo hôm nay trong lĩnh vực sản phẩm này.",
  "marketplace.plugin.braveSearch.prompt.compare": "So sánh hai nhà cung cấp này, kèm nguồn trích dẫn.",
  "marketplace.plugin.obsidian.tagline": "Ghi chú trong vault của bạn",
  "marketplace.plugin.obsidian.description":
    "Obsidian cho phép agent tìm, đọc và viết ghi chú trong vault của bạn, để vault trở thành bộ nhớ của agent. Máy chủ cục bộ kết nối với plugin Local REST API trong ứng dụng Obsidian trên máy tính này. Khóa API của plugin được truyền cho máy chủ cục bộ dưới dạng một biến môi trường. Hãy giữ Obsidian mở khi agent đang dùng.",
  "marketplace.plugin.obsidian.app":
    "Tìm, đọc và chỉnh sửa ghi chú, qua máy chủ MCP cục bộ với khóa của plugin Local REST API.",
  "marketplace.plugin.obsidian.prompt.recall": "Ghi chú của tôi nói gì về các quyết định trong dự án này?",
  "marketplace.plugin.obsidian.prompt.save": "Lưu quyết định này thành một ghi chú mới trong vault của tôi.",
  "marketplace.plugin.obsidian.prompt.log": "Thêm bản tóm tắt công việc hôm nay vào ghi chú Work log của tôi.",
  "marketplace.plugin.obsidian.hint.apiKey": "Trong Obsidian, hãy mở Settings > Local REST API và sao chép khóa API.",
  "marketplace.plugin.resend.tagline": "Email giao dịch",
  "marketplace.plugin.resend.description":
    "Resend cho phép agent gửi email giao dịch và kiểm tra trạng thái gửi qua một API. Khóa API từ bảng điều khiển Resend được truyền cho máy chủ cục bộ dưới dạng một biến môi trường.",
  "marketplace.plugin.resend.app": "Gửi email và kiểm tra trạng thái gửi, qua máy chủ MCP cục bộ với khóa API Resend.",
  "marketplace.plugin.resend.prompt.send": "Gửi bản nháp thông báo ra mắt đến danh sách beta.",
  "marketplace.plugin.resend.prompt.status": "Email hóa đơn đã đến được khách hàng chưa?",
  "marketplace.plugin.resend.prompt.template": "Soạn một email đặt lại mật khẩu cho quy trình mới.",
  "marketplace.plugin.omnisend.tagline": "Marketing qua email và SMS",
  "marketplace.plugin.omnisend.description":
    "Omnisend cho phép agent đọc báo cáo chiến dịch và biểu mẫu, tìm liên hệ và phân khúc, và tạo, chỉnh sửa chiến dịch, tự động hóa, mẫu email, biểu mẫu và sản phẩm. Mỗi người dùng kết nối bằng khóa API từ tài khoản Omnisend của riêng mình. Agent có thể làm những gì khóa cho phép, có thể bao gồm gửi chiến dịch và xóa dữ liệu.",
  "marketplace.plugin.omnisend.app":
    "Chiến dịch, tự động hóa, liên hệ, phân khúc, biểu mẫu và báo cáo, qua máy chủ MCP của Omnisend với khóa API.",
  "marketplace.plugin.omnisend.prompt.lastCampaign":
    "Các chiến dịch tuần trước hoạt động thế nào so với tuần trước đó?",
  "marketplace.plugin.omnisend.prompt.segment":
    "Phân khúc VIP có bao nhiêu liên hệ, và đã thay đổi thế nào trong tháng này?",
  "marketplace.plugin.omnisend.prompt.draftCampaign": "Soạn một chiến dịch cho bộ sưu tập mới, nhưng đừng gửi.",
  "marketplace.plugin.postiz.tagline": "Lên lịch mạng xã hội",
  "marketplace.plugin.omnisend.hint.apiKey": "Trong Omnisend, hãy mở Store settings > API keys và tạo một khóa.",
  "marketplace.plugin.postiz.description":
    "Postiz cho phép agent liệt kê các kênh mạng xã hội của bạn, và soạn, lên lịch, đăng bài trên hơn 30 mạng như X, LinkedIn, Instagram và TikTok. Agent cũng có thể tải lên nội dung đa phương tiện và tạo hình ảnh, video bằng AI. Hãy đăng nhập vào tài khoản Postiz qua trình duyệt, hoặc dán khóa API từ Settings › Developers trong Postiz. Mọi gói Postiz cloud đều có quyền truy cập API. Agent có thể đăng bài ngay lập tức, vì vậy hãy xem lại từng bài trước khi chấp thuận.",
  "marketplace.plugin.postiz.app":
    "Kênh, bản nháp, bài đã lên lịch và nội dung đa phương tiện, qua máy chủ MCP của Postiz với đăng nhập trên trình duyệt hoặc khóa API.",
  "marketplace.plugin.postiz.prompt.channels": "Những kênh mạng xã hội nào đã kết nối với Postiz?",
  "marketplace.plugin.postiz.prompt.week": "Những bài nào đã được lên lịch cho tuần sau?",
  "marketplace.plugin.postiz.prompt.draft":
    "Soạn một bài LinkedIn về bản phát hành mới của chúng ta, nhưng đừng lên lịch.",
  "marketplace.plugin.trypost.tagline": "Lên lịch mạng xã hội",
  "marketplace.plugin.trypost.description":
    "TryPost cho phép agent liệt kê các kênh đã kết nối của bạn, và soạn, lên lịch, xếp hàng đợi, đăng bài trên X, LinkedIn, Instagram, Facebook, TikTok, YouTube, Threads, Bluesky, Mastodon, Pinterest và nhiều mạng khác. Agent cũng có thể đọc số liệu phân tích, quản lý ý tưởng và phê duyệt, và đặt giờ đăng. Hãy đăng nhập vào tài khoản TryPost qua trình duyệt và chọn một không gian làm việc. Agent có thể đăng bài ngay lập tức, vì vậy hãy xem lại từng bài trước khi chấp thuận.",
  "marketplace.plugin.trypost.app":
    "Kênh, bài đăng, hàng đợi, ý tưởng và phân tích, qua máy chủ MCP của TryPost với đăng nhập trên trình duyệt.",
  "marketplace.plugin.trypost.prompt.week": "Những bài nào đã được lên lịch cho tuần này?",
  "marketplace.plugin.trypost.prompt.draft":
    "Soạn một bài LinkedIn về bản phát hành mới của chúng ta, nhưng đừng lên lịch.",
  "marketplace.plugin.trypost.prompt.analytics": "Bài nào của tôi trong tháng trước có lượt tương tác cao nhất?",
  "marketplace.plugin.composio.tagline": "Gmail, Slack, GitHub và hơn 1.000 ứng dụng khác",
  "marketplace.plugin.composio.description":
    "Composio kết nối agent của bạn với Gmail, Slack, GitHub và hơn 1.000 ứng dụng khác qua một máy chủ MCP. Hãy đăng nhập bằng tài khoản Composio của bạn. Khi agent cần một ứng dụng, agent sẽ đề nghị bạn kết nối ứng dụng đó.",
  "marketplace.plugin.composio.app":
    "Các ứng dụng bạn kết nối trong tài khoản Composio. Agent sẽ đề nghị bạn kết nối một ứng dụng khi cần.",
  "marketplace.plugin.composio.prompt.inbox":
    "Tóm tắt các email chưa đọc của tôi và soạn trả lời cho những email khẩn cấp.",
  "marketplace.plugin.composio.prompt.handoff": "Đăng bản tóm tắt pull request này lên kênh của nhóm chúng ta.",
  "marketplace.plugin.composio.prompt.apps": "Bạn có thể dùng những ứng dụng và thao tác nào qua Composio?",
  "marketplace.plugin.composio.hint.apiKey":
    "Tìm khóa trong tài khoản Composio của bạn, tại Settings > Sessions & API Key.",
  "marketplace.plugin.neon.tagline": "Dự án, nhánh và migration Postgres",
  "marketplace.plugin.neon.description":
    "Neon cho phép agent liệt kê dự án và nhánh, chạy SQL, đọc schema bảng, thử thay đổi schema trên một nhánh tạm, tìm truy vấn chậm và tìm trong tài liệu Neon. Mỗi người dùng đăng nhập vào tài khoản Neon của riêng mình qua trình duyệt và có thể chọn quyền chỉ đọc khi cấp phép. Với toàn quyền, agent có thể chạy SQL làm thay đổi hoặc xóa dữ liệu, và tạo, đặt lại hoặc xóa nhánh, cơ sở dữ liệu và dự án. Neon khuyến nghị dùng máy chủ MCP của mình cho phát triển và kiểm thử, không dùng cho cơ sở dữ liệu production.",
  "marketplace.plugin.neon.app":
    "Dự án, nhánh, SQL và migration Postgres, qua máy chủ MCP của Neon với đăng nhập trên trình duyệt.",
  "marketplace.plugin.neon.prompt.projects": "Tài khoản Neon của tôi có những dự án và nhánh nào?",
  "marketplace.plugin.neon.prompt.slowQueries":
    "Những truy vấn nào chậm nhất trên cơ sở dữ liệu Neon của tôi, và vì sao?",
  "marketplace.plugin.neon.prompt.migration":
    "Thêm một index trên bảng orders trong một nhánh tạm, và cho tôi xem kết quả trước khi áp dụng.",
  "marketplace.plugin.prisma.tagline": "Cơ sở dữ liệu Postgres, bản sao lưu và ứng dụng Compute",
  "marketplace.plugin.prisma.description":
    "Prisma cho phép agent liệt kê và tạo cơ sở dữ liệu Prisma Postgres, đọc schema, chạy SQL, liệt kê bản sao lưu và khôi phục chúng vào một cơ sở dữ liệu mới, quản lý bucket Object Storage, đọc bản build và nhật ký Compute, và tìm trong tài liệu Prisma. Mỗi người dùng đăng nhập vào tài khoản Prisma của riêng mình qua trình duyệt và chọn một không gian làm việc. Agent có toàn quyền truy cập: có thể chạy SQL làm thay đổi hoặc xóa dữ liệu, cập nhật schema, xóa cơ sở dữ liệu và bucket, và dừng, khôi phục bản trước hoặc xóa các bản triển khai Compute.",
  "marketplace.plugin.prisma.app":
    "Cơ sở dữ liệu, SQL, bản sao lưu và ứng dụng Compute, qua máy chủ MCP của Prisma với đăng nhập trên trình duyệt.",
  "marketplace.plugin.prisma.prompt.databases": "Không gian làm việc Prisma của tôi có những cơ sở dữ liệu nào?",
  "marketplace.plugin.prisma.prompt.backups": "Cho tôi xem tất cả bản sao lưu hiện có của cơ sở dữ liệu.",
  "marketplace.plugin.prisma.prompt.logs": "Hiện nhật ký runtime của bản triển khai Compute mới nhất của tôi.",
  "marketplace.plugin.netlify.tagline": "Dự án, bản triển khai và nhật ký yêu cầu",
  "marketplace.plugin.netlify.description":
    "Netlify cho phép agent liệt kê dự án và bản triển khai, đọc nhật ký yêu cầu edge, tạo dự án và triển khai mã lên một dự án có sẵn. Mỗi người dùng đăng nhập vào tài khoản Netlify của riêng mình qua trình duyệt. Agent có cùng quyền truy cập như tài khoản của người dùng: có thể thay đổi biến môi trường, biểu mẫu và quyền truy cập của khách truy cập, cài đặt hoặc gỡ tiện ích mở rộng, và xóa dữ liệu gửi qua biểu mẫu cùng biến môi trường.",
  "marketplace.plugin.netlify.app":
    "Dự án, bản triển khai, nhật ký yêu cầu và cài đặt trang web, qua máy chủ MCP của Netlify với đăng nhập trên trình duyệt.",
  "marketplace.plugin.netlify.prompt.latestDeploy":
    "Trạng thái của bản triển khai mới nhất trong từng dự án Netlify của tôi là gì?",
  "marketplace.plugin.netlify.prompt.errors": "Những URL nào trên trang web của tôi trả về lỗi máy chủ trong ngày qua?",
  "marketplace.plugin.netlify.prompt.deploy": "Triển khai thư mục này lên dự án Netlify có sẵn của tôi.",
  "marketplace.plugin.railway.tagline": "Dự án, dịch vụ và bản triển khai",
  "marketplace.plugin.railway.description":
    "Railway cho phép agent liệt kê dự án và dịch vụ, tạo dự án, triển khai lại dịch vụ và quản lý feature flag. Agent cũng có thể giao công việc nhiều bước cho Railway Agent, công cụ đọc nhật ký, tìm lý do triển khai thất bại, tạo dịch vụ và đặt biến. Mỗi người dùng đăng nhập vào tài khoản Railway của riêng mình qua trình duyệt và chọn các không gian làm việc và dự án mà agent có thể dùng. Agent có toàn quyền trong các dự án đó: có thể triển khai các thay đổi đã chuẩn bị, xóa feature flag, và thay đổi dịch vụ, biến, cơ sở dữ liệu và mạng thông qua Railway Agent.",
  "marketplace.plugin.railway.app":
    "Dự án, dịch vụ và bản triển khai, qua máy chủ MCP của Railway với đăng nhập trên trình duyệt.",
  "marketplace.plugin.railway.prompt.projects": "Không gian làm việc Railway của tôi có những dự án và dịch vụ nào?",
  "marketplace.plugin.railway.prompt.crash": "Vì sao dịch vụ backend của tôi trên Railway bị crash khi triển khai?",
  "marketplace.plugin.railway.prompt.redeploy": "Triển khai lại dịch vụ API trong dự án Railway của tôi.",
  "marketplace.plugin.render.tagline": "Dịch vụ, bản triển khai và nhật ký",
  "marketplace.plugin.render.description":
    "Render cho phép agent liệt kê không gian làm việc và dịch vụ, đọc nhật ký, sự kiện và chỉ số, xem lịch sử triển khai, kích hoạt triển khai và chạy SQL chỉ đọc trên Render Postgres. Khóa API của Render được đặt trong một header Authorization. Khóa truy cập được mọi không gian làm việc của tài khoản Render. Agent có thể tạo dịch vụ web, trang tĩnh, cron job, cơ sở dữ liệu Postgres và phiên bản Key Value, có thể phát sinh chi phí, và có thể thay thế biến môi trường của một dịch vụ. Máy chủ không thể xóa tài nguyên.",
  "marketplace.plugin.render.app":
    "Dịch vụ, bản triển khai, nhật ký và chỉ số, qua máy chủ MCP của Render với khóa API.",
  "marketplace.plugin.render.prompt.services": "Không gian làm việc Render của tôi có những dịch vụ nào?",
  "marketplace.plugin.render.prompt.logs": "Dịch vụ web Render của tôi đã ghi nhận những lỗi nào trong một giờ qua?",
  "marketplace.plugin.render.prompt.deploy": "Vì sao lần triển khai gần nhất của dịch vụ Render của tôi bị lỗi?",
  "marketplace.plugin.atlassian.tagline": "Work item Jira và trang Confluence",
  "marketplace.plugin.atlassian.description":
    "Atlassian cho phép agent tìm và đọc work item Jira, trang Confluence và pull request Bitbucket, và tạo hoặc cập nhật work item, trang và bình luận. Mỗi người dùng đăng nhập vào tài khoản Atlassian của riêng mình qua trình duyệt và chấp thuận quyền truy cập trên màn hình đồng ý. Agent có cùng quyền như người dùng: có thể thay đổi work item và trang, thay đổi quyền của trang, và merge pull request. Các công cụ xóa dữ liệu Jira sẽ tắt cho đến khi quản trị viên của tổ chức bật chúng. Mỗi lệnh gọi công cụ đều dùng credit Rovo.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence và Bitbucket, qua máy chủ MCP của Atlassian với đăng nhập trên trình duyệt.",
  "marketplace.plugin.atlassian.prompt.assigned": "Những work item Jira đang mở nào được giao cho tôi?",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "Tìm trang Confluence về quy trình phát hành của chúng ta và tóm tắt nó.",
  "marketplace.plugin.atlassian.prompt.newItem": "Tạo một work item Jira cho lỗi đăng nhập, kèm các bước tái hiện.",
  "marketplace.plugin.todoist.tagline": "Việc cần làm, dự án và lời nhắc",
  "marketplace.plugin.todoist.description":
    "Todoist cho phép agent tìm việc cần làm theo ngày, văn bản, nhãn hoặc bộ lọc, thêm và đổi lịch việc cần làm, và quản lý dự án, mục, nhãn, bình luận và lời nhắc. Mỗi người dùng đăng nhập vào tài khoản Todoist của riêng mình qua trình duyệt. Agent có quyền đọc và ghi: có thể thay đổi, hoàn tất và xóa việc cần làm, dự án và các mục khác.",
  "marketplace.plugin.todoist.app":
    "Việc cần làm, dự án và lời nhắc, qua máy chủ MCP của Todoist với đăng nhập trên trình duyệt.",
  "marketplace.plugin.todoist.prompt.today": "Những việc Todoist nào đến hạn hôm nay?",
  "marketplace.plugin.todoist.prompt.capture": "Thêm các đầu việc này vào Inbox Todoist của tôi.",
  "marketplace.plugin.todoist.prompt.overdue": "Chuyển các việc Todoist quá hạn của tôi sang ngày mai.",
  "marketplace.plugin.ticktick.tagline": "Việc cần làm, danh sách, thói quen và tập trung",
  "marketplace.plugin.ticktick.description":
    "TickTick cho phép agent tìm và lọc việc cần làm, thêm và cập nhật việc cần làm, và quản lý danh sách, mục, thư mục, thẻ và bình luận. Agent cũng có thể đọc và thay đổi thói quen cùng bản ghi tập trung, và đọc sự kiện từ các lịch đã kết nối với TickTick. Mỗi người dùng đăng nhập vào tài khoản TickTick của riêng mình qua trình duyệt. Agent có quyền đọc và ghi: có thể hoàn tất, di chuyển và xóa việc cần làm, và xóa thẻ cùng bản ghi tập trung.",
  "marketplace.plugin.ticktick.app":
    "Việc cần làm, danh sách, thói quen và bản ghi tập trung, qua máy chủ MCP của TickTick với đăng nhập trên trình duyệt.",
  "marketplace.plugin.ticktick.prompt.today": "Những việc TickTick nào đến hạn hôm nay?",
  "marketplace.plugin.ticktick.prompt.capture": "Thêm các đầu việc này vào Inbox TickTick của tôi.",
  "marketplace.plugin.ticktick.prompt.week": "Tuần trước tôi đã hoàn tất những việc TickTick nào?",
  "marketplace.plugin.trello.tagline": "Bảng, danh sách và thẻ",
  "marketplace.plugin.trello.description":
    "Trello cho phép agent tìm và đọc bảng, danh sách, thẻ, checklist và bình luận, tạo bảng và thẻ, di chuyển danh sách và thẻ, đánh dấu thẻ đã xong, và thêm checklist, bình luận và nhãn. Agent cũng có thể đọc và thêm thẻ vào Inbox Trello của người dùng, và đọc sự kiện Planner, có thể đến từ lịch Google hoặc Outlook đã kết nối. Mỗi người dùng đăng nhập vào tài khoản Trello của riêng mình qua trình duyệt và chọn không gian làm việc trên màn hình đồng ý. Agent có cùng quyền như người dùng trong các không gian làm việc đó. Agent có thể lưu trữ thẻ và danh sách, nhưng máy chủ không thể xóa vĩnh viễn bất cứ thứ gì.",
  "marketplace.plugin.trello.app": "Bảng, danh sách và thẻ, qua máy chủ MCP của Trello với đăng nhập trên trình duyệt.",
  "marketplace.plugin.trello.prompt.myCards": "Những thẻ Trello nào được giao cho tôi?",
  "marketplace.plugin.trello.prompt.board": "Tóm tắt những gì đang được thực hiện trên bảng Trello của tôi.",
  "marketplace.plugin.trello.prompt.newCards": "Thêm các đầu việc này thành thẻ trên bảng Trello của tôi.",
  "marketplace.plugin.clickup.tagline": "Việc cần làm, tài liệu và cập nhật nhóm",
  "marketplace.plugin.clickup.description":
    "ClickUp cho phép agent tìm việc cần làm, tài liệu, bình luận và tin nhắn chat, tạo và cập nhật việc cần làm, danh sách và tài liệu, đăng bình luận, gửi tin nhắn chat và theo dõi thời gian. Mỗi người dùng đăng nhập vào tài khoản ClickUp của riêng mình qua trình duyệt. Agent có cùng quyền như người dùng. Agent có thể chuyển việc cần làm vào thùng rác và xóa bình luận.",
  "marketplace.plugin.clickup.app":
    "Việc cần làm, tài liệu, bình luận, chat và theo dõi thời gian, qua máy chủ MCP của ClickUp với đăng nhập trên trình duyệt.",
  "marketplace.plugin.clickup.prompt.findTasks": "Tìm các việc ClickUp đang mở của tôi đến hạn trong tuần này.",
  "marketplace.plugin.clickup.prompt.createTask": "Tạo một việc ClickUp cho các đầu việc này và giao cho tôi.",
  "marketplace.plugin.clickup.prompt.summarizeDoc":
    "Tìm bản cập nhật dự án mới nhất trong ClickUp và tóm tắt các câu hỏi còn mở.",
  "marketplace.plugin.coinbase.tagline": "Giá tiền mã hóa, danh mục đầu tư và giao dịch",
  "marketplace.plugin.coinbase.description":
    "Coinbase cho phép agent đọc giá, số dư, danh mục đầu tư, lệnh và phí trong Coinbase Advanced Trade, xem trước và đặt lệnh, chuyển đổi giữa các tài sản, và chuyển tiền giữa các danh mục. Mỗi người dùng đăng nhập vào tài khoản Coinbase của riêng mình qua trình duyệt. Agent có cùng quyền như người dùng. Lệnh và chuyển đổi dùng tiền thật, và agent có thể thanh toán các yêu cầu x402 từ số dư USDC.",
  "marketplace.plugin.coinbase.app":
    "Giá, số dư, danh mục đầu tư, lệnh và chuyển đổi, qua máy chủ MCP của Coinbase với đăng nhập trên trình duyệt.",
  "marketplace.plugin.coinbase.prompt.balances": "Số dư Coinbase của tôi trong từng danh mục là bao nhiêu?",
  "marketplace.plugin.coinbase.prompt.price": "Hiện giá BTC-USD trên Coinbase và biến động của nó trong tuần này.",
  "marketplace.plugin.coinbase.prompt.previewOrder":
    "Xem trước lệnh mua ETH theo giá thị trường trị giá 50 USD trên Coinbase. Đừng đặt lệnh.",
  "marketplace.plugin.robinhood.tagline": "Tài khoản môi giới và giao dịch bằng agent",
  "marketplace.plugin.robinhood.description":
    "Robinhood cho phép agent đọc tài khoản, vị thế, số dư, lịch sử giao dịch và danh sách theo dõi của khách hàng Robinhood, đọc dữ liệu thị trường, và đặt lệnh cổ phiếu, quyền chọn và tiền mã hóa. Mỗi người dùng đăng nhập vào tài khoản Robinhood của riêng mình qua trình duyệt. Ở lần đăng nhập đầu tiên, Robinhood yêu cầu người dùng mở một tài khoản Agentic riêng. Agent chỉ có thể giao dịch trong tài khoản đó, và theo mặc định sẽ đặt lệnh mà không cần người dùng chấp thuận từng lệnh.",
  "marketplace.plugin.robinhood.app":
    "Tài khoản, vị thế, dữ liệu thị trường và giao dịch, qua máy chủ MCP của Robinhood với đăng nhập trên trình duyệt.",
  "marketplace.plugin.robinhood.prompt.positions":
    "Tóm tắt các vị thế Robinhood của tôi và biến động của chúng hôm nay.",
  "marketplace.plugin.robinhood.prompt.watchlist":
    "Từng cổ phiếu trong danh sách theo dõi Robinhood của tôi biến động thế nào trong tuần này?",
  "marketplace.plugin.robinhood.prompt.agenticCash": "Tài khoản Robinhood Agentic của tôi có bao nhiêu tiền mặt?",
  "marketplace.plugin.huggingface.tagline": "Mô hình, tập dữ liệu và bài báo trên Hub",
  "marketplace.plugin.huggingface.description":
    "Hugging Face cho phép agent tìm mô hình, tập dữ liệu, Space, bộ sưu tập và bài báo trên Hugging Face Hub, đọc model card và tệp trong kho mã, xem trước tập dữ liệu và tìm trong tài liệu Hugging Face. Plugin dùng dữ liệu công khai của Hub, không cần tài khoản hay khóa. Các công cụ chỉ đọc: agent không thể tạo kho mã hay chạy job.",
  "marketplace.plugin.huggingface.app":
    "Tìm mô hình, tập dữ liệu, Space, bài báo và tài liệu, qua máy chủ MCP của Hugging Face, không cần đăng nhập.",
  "marketplace.plugin.huggingface.prompt.models": "Tìm các mô hình mở nhỏ cho nhận dạng giọng nói trên Hugging Face.",
  "marketplace.plugin.huggingface.prompt.papers": "Những bài báo nào đang thịnh hành trên Hugging Face hôm nay?",
  "marketplace.plugin.huggingface.prompt.dataset":
    "Tìm một tập dữ liệu chuỗi thời gian thời tiết và hiện các cột của nó.",
  "marketplace.auth.apiKey": "Khóa API",
  "marketplace.auth.personalApiKey": "Khóa API cá nhân",
  "marketplace.auth.createKey": "Tạo khóa",

  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Thử trong {name}",

  "marketplace.skills.yours": "Kỹ năng của bạn",
  "marketplace.skills.seeAll": "Xem tất cả",
  "marketplace.skills.seeAllName": "Xem tất cả: {name}",
  "marketplace.skills.none": "Chưa có agent nào có kỹ năng.",
  "marketplace.skills.noneHint":
    "Mỗi kỹ năng dạy agent một tác vụ. Hãy thêm một kỹ năng bên dưới, hoặc tự tạo kỹ năng của bạn.",
  "marketplace.skills.sourceLabel": "Nguồn",
  "marketplace.skills.source.all": "Tất cả",
  "marketplace.skills.source.verified": "Đã xác minh",
  "marketplace.skills.source.public": "Công khai",
  "marketplace.skills.source.verifiedLong": "Được OpenBot xác minh",
  "marketplace.skills.source.publicLong": "Được OpenBot xem xét",
  "marketplace.skills.sortLabel": "Sắp xếp",
  "marketplace.skills.sortName": "Sắp xếp: {name}",
  "marketplace.skills.sort.installs": "Dùng nhiều nhất",
  "marketplace.skills.sort.updated": "Cập nhật gần đây",
  "marketplace.skills.sort.name": "Tên",
  "marketplace.skills.featured": "Nổi bật",
  "marketplace.skills.all": "Tất cả kỹ năng",
  "marketplace.skills.count": { one: "{count} kỹ năng", other: "{count} kỹ năng" },
  "marketplace.skills.searchIn": "Tìm trong {name}",
  "marketplace.skills.missing": "Kỹ năng này không có trong Cửa hàng.",
  "marketplace.skills.state.off": "Tắt",
  "marketplace.skills.state.repair": "Cần sửa",
  "marketplace.skills.state.update": "Có bản cập nhật",
  "marketplace.skills.state.modified": "Bạn đã thay đổi",
  "marketplace.skills.stateOn": "{state} trên {agents}",
  "marketplace.skills.version": "Phiên bản {version}",
  "marketplace.skills.origin.local": "Tạo trên máy tính này",
  "marketplace.skills.origin.workspace": "Trong thư mục của agent này",
  "marketplace.skills.origin.marketplace": "Từ Cửa hàng · phiên bản {version}",
  "marketplace.skills.origin.github": "Từ GitHub · {repository}",
  "marketplace.skills.github.search": "Tìm kiếm, hoặc dán liên kết GitHub",
  "marketplace.skills.github.reading": "Đang tìm kỹ năng trong kho mã",
  "marketplace.skills.github.trust": "OpenBot chưa xem xét các kỹ năng từ GitHub. Hãy đọc kỹ năng trước khi thêm.",
  "marketplace.skills.github.source": "GitHub · {repository} tại {commit}",
  "marketplace.skills.github.open": "GitHub",
  "marketplace.skills.github.openName": "Mở {repository} trên GitHub",
  "marketplace.skills.status.notAdded": "Chưa thêm",
  "marketplace.skills.status.on": "Trên {agents}",
  "marketplace.skills.agentCount": { one: "{count} agent", other: "{count} agent" },
  "marketplace.skills.allAgents": "tất cả agent",
  "marketplace.skills.agentsTitle": "Agent · {total}",
  "marketplace.skills.agents.search": "Tìm agent",
  "marketplace.skills.agents.searchName": "Tìm các agent có {name}",
  "marketplace.skills.agents.noMatch": "Không có agent nào khớp với “{query}”.",
  "marketplace.skills.agents.removeAll": "Gỡ tất cả",
  "marketplace.skills.agents.removeAllName": {
    one: "Gỡ {name} khỏi {count} agent",
    other: "Gỡ {name} khỏi tất cả {count} agent",
  },
  "marketplace.skills.agent.toggle": "{name} cho {agent}",
  "marketplace.skills.agent.remove": "Gỡ",
  "marketplace.skills.agent.removeName": "Gỡ {name} khỏi {agent}",
  "marketplace.skills.add": "Thêm",
  "marketplace.skills.addName": "Thêm {name} vào agent",
  "marketplace.skills.addToAgents": "Thêm vào agent",
  "marketplace.skills.onOf": "Trên {have}/{total}",
  "marketplace.skills.chooseAgents": "{name} đang có trên {agents}. Chọn agent",
  "marketplace.skills.dialog.list": "Agent có {name}",
  "marketplace.skills.dialog.search": { one: "Tìm trong {count} agent", other: "Tìm trong {count} agent" },
  "marketplace.skills.dialog.all": { one: "Tất cả {count} agent", other: "Tất cả {count} agent" },
  "marketplace.skills.dialog.allMatches": { one: "Tất cả {count} kết quả", other: "Tất cả {count} kết quả" },
  "marketplace.skills.dialog.checked": "{checked}/{total}",
  "marketplace.skills.dialog.save": "Lưu",
  "marketplace.skills.dialog.saveBoth": "Lưu: thêm {added}, gỡ {removed}",
  "marketplace.skills.dialog.addTo": "Thêm vào {agents}",
  "marketplace.skills.dialog.removeFrom": "Gỡ khỏi {agents}",
  "marketplace.skills.dialog.full": "Đã đạt giới hạn kỹ năng",
  "marketplace.skills.dialog.unread": "Chưa đọc được kỹ năng",
  "marketplace.skills.local.gone": "Hiện không có agent nào có kỹ năng này.",

  "marketplace.notice.agentAdded": "Đã thêm {name}.",
  "marketplace.notice.agentUpdated": "Đã cập nhật {name}.",
  "marketplace.notice.appConnected": "Đã kết nối {name}.",
  "marketplace.notice.appDisconnected": "Đã ngắt kết nối {name}.",
  "marketplace.notice.serverRemoved": "Đã gỡ {name}.",
  "marketplace.notice.skillInstalled": {
    one: "Đã cài đặt {name} trên {count} agent.",
    other: "Đã cài đặt {name} trên {count} agent.",
  },
  "marketplace.notice.skillRemoved": {
    one: "Đã gỡ {name} khỏi {count} agent.",
    other: "Đã gỡ {name} khỏi {count} agent.",
  },
  "marketplace.error.skillPartial": "{name} không thay đổi trên các agent sau: {agents}. {reason}",

  "marketplace.error.openLink": "Không mở được liên kết.",
  "marketplace.error.copyLink": "Không sao chép được liên kết.",
  "marketplace.error.connectNoServer": "Hãy chọn một máy chủ cục bộ để kết nối ứng dụng này.",
  "marketplace.error.installNoServer": "Hãy chọn một máy chủ cục bộ để cài đặt plugin.",
  "marketplace.error.installNoAgent": "Hãy chọn một agent để cài đặt các kỹ năng của plugin này.",
  "marketplace.error.installLocalOnHost":
    "Hãy cài đặt {name} trên máy tính chạy các agent này: ứng dụng của plugin chạy máy chủ trên máy tính đó.",
  "marketplace.error.installOnHost":
    "Hãy cài đặt {name} trên máy tính chạy các agent này: ứng dụng của plugin cần đăng nhập trên trình duyệt.",
  "marketplace.error.appInvalid": "Không thể thêm {name}: {reason}",
  "marketplace.error.uninstallNoServer": "Hãy chọn một máy chủ cục bộ để gỡ cài đặt plugin.",
  "marketplace.error.uninstallPartial": "Không gỡ được một phần của {name}. {failures}",
  "marketplace.error.actionFailed": "Không hoàn tất được thao tác trong Cửa hàng. Hãy thử lại.",
  "marketplace.thisAgent": "agent này",
} as const satisfies PartialTranslation<typeof source>;
