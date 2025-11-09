// 全域變數
var isMuted = false;
var board = null;
var currentAnalysisData = [];
var currentMoveIndex = -1;
// var highlightedSquares = []; // (已改用 CSS class 控制，此變數可暫時保留或移除，下面程式碼主要依賴 jQuery 選擇器清除)
var currentBoardTheme = 'green';
var currentPieceTheme = 'wikipedia';
var rightClickStartSquare = null; // <-- 【新】加入此行

// 當頁面 DOM 載入完成後執行
$(document).ready(function() {
    console.log("Document ready 已觸發。");

    // --- 1. 從 localStorage 載入設定 ---
    var savedPieceTheme = localStorage.getItem('pieceTheme');
    if (savedPieceTheme && ['wikipedia', 'neo'].includes(savedPieceTheme)) {
        currentPieceTheme = savedPieceTheme;
        $('#piece-theme-select').val(savedPieceTheme);
    }
    var savedBoardTheme = localStorage.getItem('boardTheme');
    if (savedBoardTheme) {
        currentBoardTheme = savedBoardTheme;
        $('#board-theme-select').val(savedBoardTheme);
    }

    // --- 2. 初始化棋盤 ---
    board = Chessboard('myBoard', {
        position: 'start',
        draggable: false,
        pieceTheme: `img/chesspieces/${currentPieceTheme}/{piece}.png`
    });
    applyBoardTheme(currentBoardTheme);

    // --- 3. 綁定按鈕事件 ---
    
    // 開始分析
    $('#analyze-button').on('click', startAnalysis);
    
    // 上一手 / 下一手
    $('#prev-move').on('click', function() { showMove(currentMoveIndex - 1); });
    $('#next-move').on('click', function() { showMove(currentMoveIndex + 1); });

    // 翻轉棋盤 (同時要重繪箭頭)
    $('#flip-board-button').on('click', function() {
        if (board) {
            board.flip();
            // 翻轉後，如果有顯示中的棋步，強制重繪以更新箭頭方向
            if (currentMoveIndex >= 0) {
                // 傳入 true 作為第二個參數，表示強制重繪，即使 index 沒變
                showMove(currentMoveIndex, true);
            }
        }
    });

    // 靜音切換
    $('#mute-toggle-button').on('click', function() {
        isMuted = !isMuted;
        $('#mute-icon').attr('src', isMuted ? 'icons/volume_off.png' : 'icons/volume_on.png');
        if (isMuted) {
            try {
                document.getElementById('move-sound').pause();
                document.getElementById('check-sound').pause();
            } catch (e) {}
        }
    });

    // 總結區塊收合
    $('#summary-toggle').on('click', function() {
        var $content = $('#analysis-summary-content');
        $content.slideToggle(200);
        setTimeout(function() {
            var arrow = $content.is(':visible') ? '&#9652;' : '&#9662;';
            $('#summary-toggle').html('對局總結 (點擊展開/收合) ' + arrow);
        }, 210);
    });

    // 棋步列表點擊
    $('#analysis-container').on('click', '.move-item-col', function() {
        var index = $(this).data('index');
        if (typeof index !== 'undefined') {
            showMove(parseInt(index, 10));
        }
    });

    // 下拉選單變更
    $('#board-theme-select').on('change', function() {
        applyBoardTheme($(this).val());
    });
    $('#piece-theme-select').on('change', function() {
        applyPieceTheme($(this).val());
    });

// --- 【新】滑鼠右鍵繪製箭頭的功能 ---
    var $boardContainer = $('#board-container-wrapper'); // 綁定到棋盤的父容器
    // (rightClickStartSquare 已移至全域)

    // 1. 阻止棋盤預設的右鍵選單
    $boardContainer.on('contextmenu', function(e) {
        e.preventDefault();
    });

    // 2. 監聽滑鼠右鍵按下 (記住起始點)
    $boardContainer.on('mousedown', function(e) {
        if (e.which !== 3) return; // 只處理右鍵
        var $square = $(e.target).closest('[data-square]'); // 找到點擊的格子
        if ($square.length) {
            rightClickStartSquare = $square.data('square');
        }
    });

    // 3. 監聽滑鼠右鍵放開 (繪製或清除)
    $boardContainer.on('mouseup', function(e) {
        if (e.which !== 3) return; // 只處理右鍵

        var $square = $(e.target).closest('[data-square]');
        
        if (rightClickStartSquare && $square.length) {
            // 右鍵有按下，且在一個格子上放開
            var endSquare = $square.data('square');
            if (endSquare === rightClickStartSquare) {
                // 如果在同一個格子放開 (只是點擊) -> 清除所有「手動」箭頭
                clearManualArrows();
            } else {
                // 如果在不同格子放開 (拖曳) -> 繪製橘色箭頭
                drawArrow(rightClickStartSquare, endSquare, 'orange');
            }
        } else if (!rightClickStartSquare && !$square.length) {
             // 如果在棋盤外圍點擊
             clearManualArrows();
        }
        
        rightClickStartSquare = null; // 重置起始點
    });
    // --- 結束 繪製箭頭功能 ---

}); // --- $(document).ready 結束 ---


// =========================================
//  核心功能函式
// =========================================

/**
 * 開始分析：重置狀態並發送 PGN
 */
function startAnalysis() {
    var pgnText = "";
    var fileInput = $('#pgn-file-input')[0];
    var textInput = $('#pgn-text-input').val();
    var analysisContainer = $('#analysis-container');

    analysisContainer.html("<h3>分析中...</h3><p style='padding: 10px;'>正在將 PGN 發送到後端伺服器...<br>這可能需要 10-30 秒，請稍候。</p>");

    // 重設所有狀態
    board.position('start');
    updateWinRateDisplay(50, 50);
    currentAnalysisData = [];
    currentMoveIndex = -1;
    removeHighlights(); // 清除舊高亮
    
    // --- 【修正】 ---
    // 替換掉舊的 clearArrows()
    clearAutoArrows();  // 清除自動（綠色）箭頭
    clearManualArrows(); // 清除手動（橘色）箭頭
    // --- 結束修正 ---
    
    $('#analysis-summary-content').hide().html("");
    $('#summary-toggle').html('對局總結 (點擊展開/收合) &#9662;');
    $('#opening-name-display').html("<i>讀取開局名稱...</i>");

    // 讀取 PGN
    if (textInput && textInput.trim() !== "") {
        processPGN(textInput.trim());
    } else if (fileInput.files.length > 0) {
        var reader = new FileReader();
        reader.onload = function(e) {
            processPGN(e.target.result);
        };
        reader.onerror = function() {
            analysisContainer.html("<h3>錯誤</h3><p>讀取檔案時發生錯誤。</p>");
        };
        reader.readAsText(fileInput.files[0]);
    } else {
        analysisContainer.html("<h3>錯誤</h3><p>請上傳 PGN 檔案或在文字框中貼上內容。</p>");
    }
}

/**
 * 發送 PGN 到後端並處理回應
 */
async function processPGN(pgnString) {
    var analysisContainer = $('#analysis-container');
    try {
        // 注意：請確保此 URL 與您 server.py 的設定一致
        const response = await fetch('http://127.0.0.1:5000/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pgn: pgnString })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.status === 'success') {
                currentAnalysisData = data.analysis;
                displayAnalysis(currentAnalysisData);
                displaySummary(data.summary);

                // 顯示開局名稱
                var openingInfo = data.opening_name || { en: "Unknown Opening", zh: "未知開局" };
                var openingHTML = escapeHTML(openingInfo.en);
                if (openingInfo.zh && openingInfo.zh.trim() !== "") {
                    openingHTML += ` / ${escapeHTML(openingInfo.zh)}`;
                }
                $('#opening-name-display').html(openingHTML);

            } else {
                analysisContainer.html("<h3>後端錯誤</h3><p>" + escapeHTML(data.error) + "</p>");
            }
        } else {
            analysisContainer.html("<h3>伺服器錯誤</h3><p>HTTP 狀態碼: " + response.status + "</p>");
        }
    } catch (error) {
        analysisContainer.html("<h3>連線錯誤</h3><p>無法連線到後端伺服器。請確認 `python server.py` 正在運行。</p>");
        console.error("Fetch error:", error);
    }
}


// =========================================
//  高亮與箭頭繪製 (SVG)
// =========================================

/**
 * 高亮特定格子 (使用 CSS class)
 */
function highlightSquare(square, cssClass) {
    var $square = $('#myBoard .square-' + square);
    $square.addClass(cssClass);
}

/**
 * 清除所有格子高亮
 */
function removeHighlights() {
    $('#myBoard .square-55d63').removeClass('highlight-last-move highlight-best-move highlight-actual-move');
}

/**
 * 【新】清除 SVG 上的「自動」箭頭 (綠色)
 */
function clearAutoArrows() {
    $('#arrow-overlay .auto-arrow').remove();
}

/**
 * 【新】清除 SVG 上的「手動」箭頭 (橘色)
 */
function clearManualArrows() {
    $('#arrow-overlay .manual-arrow').remove();
}

/**
 * 【修改】將棋盤座標 (e.g., "e4") 轉換為 SVG 像素座標
 *
 * (您的舊版本可能沒有 + squareSize / 2，導致箭頭沒有置中)
 */
function squareToCoords(square) {
    var fileStr = square.charAt(0); // 'a' 到 'h'
    var rankStr = square.charAt(1); // '1' 到 '8'
    var file = fileStr.charCodeAt(0) - 'a'.charCodeAt(0); // 0-7
    var rank = parseInt(rankStr) - 1; // 0-7 (0 is rank 1, 7 is rank 8)

    var squareSize = 70; // 棋盤 560px / 8格 = 70px
    var x, y;

    // 根據棋盤目前的翻轉狀態計算座標
    if (board.orientation() === 'white') {
        // 白方在下
        x = file * squareSize + squareSize / 2; // 【重要】加上半個格子寬度
        y = (7 - rank) * squareSize + squareSize / 2; // 【重要】加上半個格子高度
    } else {
        // 黑方在下
        x = (7 - file) * squareSize + squareSize / 2; // 【重要】加上半個格子寬度
        y = rank * squareSize + squareSize / 2; // 【重要】加上半個格子高度
    }

    return { x: x, y: y };
}

/**
 * 【修改】在 SVG 上繪製箭頭 (線條變細、透明度增加)
 * @param {string} from - 起始格 (e.g., "e2")
 * @param {string} to - 結束格 (e.g., "e4")
 * @param {string} colorType - 'green' (自動) 或 'orange' (手動)
 */
function drawArrow(from, to, colorType) {
    if (!from || !to || from === 'N/A' || to === 'N/A') return;

    var start = squareToCoords(from);
    var end = squareToCoords(to);

    var colorHex, markerId, arrowClass;

    if (colorType === 'green') {
        colorHex = '#22c55e';
        markerId = 'url(#arrowhead-green)';
        arrowClass = 'arrow auto-arrow'; // 自動箭頭 class
    } else {
        colorHex = '#f97316';
        markerId = 'url(#arrowhead-orange)';
        arrowClass = 'arrow manual-arrow'; // 手動箭頭 class
    }

    // 使用原生 DOM 創建 SVG 元素
    var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", end.x);
    line.setAttribute("y2", end.y);
    line.setAttribute("stroke", colorHex);
    
    // --- 【修改】 ---
    line.setAttribute("stroke-width", "8");      // 箭頭線條寬度 (從 10 降為 8)
    line.setAttribute("stroke-opacity", "0.6");  // 透明度 (從 0.8 降為 0.6)
    // --- 結束修改 ---

    line.setAttribute("marker-end", markerId);    // 箭頭尖端
    line.setAttribute("pointer-events", "none");  // 讓滑鼠點擊穿透
    line.setAttribute("class", arrowClass);

    $('#arrow-overlay').append(line);
}


// =========================================
//  顯示棋步的主函式
// =========================================

/**
 * 【修改】顯示指定索引的棋步 (更新綠箭頭顯示邏輯)
 * @param {number} index - 棋步索引
 * @param {boolean} forceRedraw - 是否強制重繪 (用於翻轉棋盤時)
 */
function showMove(index, forceRedraw = false) {
    // 1. 邊界檢查
    var minIndex = -1;
    var maxIndex = currentAnalysisData.length - 1;
    if (index < minIndex) index = minIndex;
    if (index > maxIndex) index = maxIndex;

    // 如果索引沒變且不是強制重繪，則忽略
    if (index === currentMoveIndex && !forceRedraw) {
        return;
    }
    
    currentMoveIndex = index;

    // 2. 清除舊狀態
    removeHighlights();        // 清除旧的黃色高亮
    clearAutoArrows();         // 只清除「自動」的綠色箭頭
    // (保留使用者手動繪製的橘色箭頭)
    
    $('#analysis-container .move-item-col').removeClass('selected');

    // 3. 處理初始局面 (-1)
    if (index === -1) {
        board.position('start');
        updateWinRateDisplay(50, 50);
        $('#analysis-container').animate({ scrollTop: 0 }, 150);
        clearAutoArrows();     // 回到開局時，清除自動箭頭
        clearManualArrows();   // 回到開局時，清除手動箭頭
        return;
    }

    // 4. 獲取數據並更新顯示
    var moveData = currentAnalysisData[index];
    if (moveData) {
        // 更新棋盤
        board.position(moveData.fen);

        // 播放聲音 (僅在非強制重繪時播放)
        if (!isMuted && !forceRedraw) {
            try {
                var sound = moveData.is_check ? document.getElementById('check-sound') : document.getElementById('move-sound');
                if (sound) { sound.currentTime = 0; sound.play(); }
            } catch (e) {}
        }

        // 更新勝率
        updateWinRateDisplay(moveData.win_rate_white, moveData.win_rate_black);

        // 高亮列表並滾動
        var $moveCol = $('#analysis-container .move-item-col[data-index="' + index + '"]');
        $moveCol.addClass('selected');
        scrollToMove($moveCol.closest('.move-pair'));

        // --- A. 高亮「實際走法」的格子 (黃色背景) ---
        if (moveData.actual_move_from && moveData.actual_move_to) {
            highlightSquare(moveData.actual_move_from, 'highlight-last-move');
            highlightSquare(moveData.actual_move_to, 'highlight-last-move');
        }

        // --- B. 【修改】如果是「任何非最佳棋步」，自動繪製「綠色」最佳箭頭 ---
        if (moveData.move_quality && 
            moveData.move_quality !== "Best Move" &&
            moveData.move_quality !== "Book Move") { // (也排除 "Book Move"，以備將來)
            
            // 只要不是 "Best Move"，就顯示綠色箭頭
            drawArrow(moveData.best_move_from, moveData.best_move_to, 'green');
        }
        
        // --- C. (手動橘色箭頭由 'mousedown'/'mouseup' 事件獨立處理，不受此函式影響) ---
    }
}

// =========================================
//  其他 UI 輔助函式
// =========================================

function scrollToMove($element) {
    var $container = $('#analysis-container');
    if (!$element || $element.length === 0) return;
    try {
        // 計算滾動位置，讓當前棋步顯示在列表上方一點的位置
        $container.animate({
            scrollTop: $element.position().top - $container.position().top + $container.scrollTop() - 60
        }, 150);
    } catch (e) {}
}

function updateWinRateDisplay(white, black) {
    $('#win-rate-text').html(`白方: ${white}% | 黑方: ${black}%`);
    $('#white-bar').css('width', white + '%');
}

function displayAnalysis(results) {
    var $container = $('#analysis-container');
    $container.html("");
    if (results.length === 0) {
        $container.append("<p style='padding:10px;'>沒有找到任何棋步。</p>");
        return;
    }

    var $list = $("<div class='move-list-container'></div>");
    var movesByNum = {};
    // 按步數分組
    results.forEach((m, i) => {
        if (!movesByNum[m.move_number]) movesByNum[m.move_number] = {};
        movesByNum[m.move_number][m.color] = { ...m, originalIndex: i };
    });

    // 產生列表 HTML
    for (var num in movesByNum) {
        var white = movesByNum[num]["White"];
        var black = movesByNum[num]["Black"];
        var $pair = $("<div class='move-pair'><div class='move-number'>" + num + ".</div></div>");
        $pair.append(createMoveColHTML(white));
        $pair.append(createMoveColHTML(black));
        $list.append($pair);
    }
    $container.append($list);
    showMove(-1); // 顯示初始局面
}

/**
 * 【修改】產生單一棋步的 HTML (為好棋加入新的 CSS class)
 */
function createMoveColHTML(data) {
    if (!data) return "<div class='move-item-col'></div>"; // 如果沒有這一步 (例如最後一步是白棋)

    var quality = data.move_quality || "";
    var bestMove = data.best_move || "";
    var moveSan = data.move || "";

    // 1. 決定 CSS class (用於紅/黃/橘色背景)
    var itemClassSuffix = '';
    if (quality.includes("Mistake")) itemClassSuffix = ' mistake';
    if (quality.includes("Blunder")) itemClassSuffix = ' blunder';
    if (quality.includes("Inaccuracy")) itemClassSuffix = ' inaccuracy';

    // 2. 決定顯示的文字和內容
    var detailHTML = "";
    var qualityText = "";
    
    // 【新】為「好棋」定義基礎 CSS class
    var goodMoveBaseClass = "analysis-detail-good"; 

    switch (quality) {
        case "Best Move":
            qualityText = "最佳 (Best Move!)";
            // 我們使用淺藍色 (類似 Chess.com) 來標記最佳
            detailHTML = `<div class="${goodMoveBaseClass} quality-best"><b>${qualityText}</b></div>`; // <-- 新 class
            break;
        case "Excellent":
            qualityText = "太棒了 (Excellent!)";
            // 我們使用淺綠色來標記太棒了
            detailHTML = `<div class="${goodMoveBaseClass} quality-excellent"><b>${qualityText}</b></div>`; // <-- 新 class
            break;
        case "Good":
            qualityText = "很棒 (Good)";
            // 我們使用淺灰色來標記很棒
            detailHTML = `<div class="${goodMoveBaseClass} quality-good">${qualityText}</div>`; // <-- 新 class
            break;
        case "Inaccuracy":
            qualityText = "誤著 (Inaccuracy)";
            // 壞棋的 HTML 保持不變 (它們已經有紅/橘/黃背景了)
            detailHTML = `<div class="analysis-detail move-col-analysis"><b>${qualityText}</b> 最佳: ${escapeHTML(bestMove)}</div>`;
            break;
        case "Mistake":
            qualityText = "失誤 (Mistake!)";
            detailHTML = `<div class="analysis-detail move-col-analysis"><b>${qualityText}</b> 最佳: ${escapeHTML(bestMove)}</div>`;
            break;
        case "Blunder":
            qualityText = "大漏著 (Blunder!)";
            detailHTML = `<div class="analysis-detail move-col-analysis"><b>${qualityText}</b> 最佳: ${escapeHTML(bestMove)}</div>`;
            break;
        case "Book Move":
            qualityText = "開局 (Book)";
            detailHTML = `<div class="${goodMoveBaseClass} quality-good">${qualityText}</div>`; // Book Move 也用淺灰色
            break;
        default:
             // 如果沒有 quality，就什麼都不顯示
             detailHTML = "";
             break;
    }
    
    // 3. 組合 HTML
    return `<div class='move-item-col${itemClassSuffix}' data-index="${data.originalIndex}">
                <span class="move-san">${escapeHTML(moveSan)}</span>
                ${detailHTML}
            </div>`;
}

function displaySummary(summary) {
    var html = "<h4>對局總結 (評分: 估算水準)</h4>";
    ['White', 'Black'].forEach(player => {
        var d = summary[player];
        var pName = player === 'White' ? '白方' : '黑方';
        html += `<div class="summary-player-section"><strong>${pName}</strong> | 評分: <strong>${d.elo}</strong> (ACPL: ${d.acpl})<ul>`;
        html += `<li>超級棒 (Best): ${d["Best Move"]}</li>`;
        html += `<li>很棒 (Excellent): ${d.Excellent}</li>`;
        html += `<li>正常 (Good): ${d.Good}</li>`;
        html += `<li>小錯誤 (Inaccuracy): ${d.Inaccuracy}</li>`;
        html += `<li>中錯誤 (Mistake): ${d.Mistake}</li>`;
        html += `<li>大錯誤 (Blunder): ${d.Blunder}</li>`;
        html += `</ul></div>`;
    });
    $('#analysis-summary-content').html(html);
}

function applyBoardTheme(theme) {
    $('#myBoard')
        .removeClass('board-theme-wood board-theme-green board-theme-blue board-theme-grey')
        .addClass('board-theme-' + theme);
    currentBoardTheme = theme;
    localStorage.setItem('boardTheme', theme);
}

function applyPieceTheme(theme) {
    if (!board) return;
    var fen = board.fen();
    // 清空棋盤 DOM 並重新初始化以應用新棋子圖片
    $('#myBoard').empty();
    currentPieceTheme = theme;
    board = Chessboard('myBoard', {
        position: fen,
        draggable: false,
        pieceTheme: `img/chesspieces/${currentPieceTheme}/{piece}.png`
    });
    // 重新應用棋盤主題
    applyBoardTheme(currentBoardTheme);
    // 如果當前有顯示棋步，稍微延遲後重繪以恢復高亮和箭頭
    if (currentMoveIndex >= 0) {
        setTimeout(() => showMove(currentMoveIndex, true), 50);
    }
    localStorage.setItem('pieceTheme', theme);
}

function escapeHTML(str) {
    return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}