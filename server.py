import chess
import chess.engine
import chess.pgn
import io
import math
from flask import Flask, request, jsonify
from flask_cors import CORS

# ---------------------------------------------------------------
# 設定
# ---------------------------------------------------------------
STOCKFISH_PATH = "./stockfish.exe" 
ANALYSIS_DEPTH = 17  

# ---------------------------------------------------------------
# Flask 伺服器設定
# ---------------------------------------------------------------
app = Flask(__name__)
CORS(app, resources={r"/analyze": {"origins": "null"}}) 

# ---------------------------------------------------------------
# 輔助函式 (勝率 & 錯誤類型) - (這部分不變)
# ---------------------------------------------------------------
def score_to_win_rate(score_cp, is_white_turn):
    score_cp = max(min(score_cp, 2000), -2000)
    win_rate_white = 1 / (1 + 10**(-score_cp / 400))
    return win_rate_white

def get_move_quality(score_loss):
    """根據分數損失判斷棋步品質"""
    # score_loss 是指你比起「最佳走法」"損失"了多少分數

    if score_loss <= 10:
        return "Best Move"  # 超級棒
    elif score_loss <= 30:
        return "Excellent"  # 很棒
    elif score_loss <= 70:
        return "Good"       # 正常
    elif score_loss <= 149:
        return "Inaccuracy" # 小錯誤
    elif score_loss <= 299:
        return "Mistake"    # 中錯誤
    else:
        return "Blunder"    # 大錯誤
# ---------------------------------------------------------------
# 核心分析函式 (升級版)
# ---------------------------------------------------------------
def analyze_pgn(pgn_text):
    
    try:
        engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
    except Exception as e:
        return {"error": f"啟動 Stockfish 失敗: {e}"}

    pgn_file = io.StringIO(pgn_text)
    game = chess.pgn.read_game(pgn_file)
    if game is None:
        engine.quit()
        return {"error": "無法解析 PGN。"}

    analysis_results = []
    board = game.board()

    # 【新】初始化總結計數器
    summary = {
        "White": {"Best Move": 0, "Excellent": 0, "Good": 0, "Inaccuracy": 0, "Mistake": 0, "Blunder": 0, "total_loss": 0, "move_count": 0, "acpl": 0},
        "Black": {"Best Move": 0, "Excellent": 0, "Good": 0, "Inaccuracy": 0, "Mistake": 0, "Blunder": 0, "total_loss": 0, "move_count": 0, "acpl": 0}
    }
    print("引擎啟動成功，開始分析棋局...")

    try:
        move_number = 1
        is_white_move = True
        
        initial_info = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
        last_score_cp = initial_info["score"].white().score(mate_score=30000)

        for move in game.mainline_moves():
            
            # --- 3a. 在走棋 *之前*，分析當前局面 ---
            info_before = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
            
            # 【關鍵修改】不只拿 SAN，也拿 From/To
            best_move_san = "N/A"
            best_move_from = "N/A"
            best_move_to = "N/A"
            best_move_object = info_before.get("pv", [None])[0]
            
            if best_move_object:
                best_move_san = board.san(best_move_object)
                # 從 chess.Move 物件中獲取 "g1", "f3" 這種座標
                best_move_from = chess.square_name(best_move_object.from_square)
                best_move_to = chess.square_name(best_move_object.to_square)
            
            best_score_cp = info_before["score"].white().score(mate_score=30000)

            # --- 3b. 實際走 PGN 中的那一步棋 ---
            move_san = board.san(move)
            actual_move_from = chess.square_name(move.from_square)
            actual_move_to = chess.square_name(move.to_square)
            board.push(move)
            
            # --- 3c. 在走棋 *之後*，分析新局面 ---
            info_after = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
            current_score_cp = info_after["score"].white().score(mate_score=30000)
            
            # --- 3d. 比較分數 & 計算勝率 ---
            score_loss = 0
            if is_white_move:
                score_loss = best_score_cp - current_score_cp
            else:
                score_loss = current_score_cp - best_score_cp 
                
            move_quality = get_move_quality(score_loss)

            player = "White" if is_white_move else "Black"
            summary[player]["move_count"] += 1
            summary[player]["total_loss"] += score_loss
            if move_quality:
                summary[player][move_quality] += 1

            win_rate_white = score_to_win_rate(current_score_cp, not is_white_move)
            win_rate_black = 1.0 - win_rate_white

            # --- 3e. 儲存結果 (加入 from/to) ---
            analysis_results.append({
                "move_number": move_number,
                "color": "White" if is_white_move else "Black",
                "move": move_san,
                "fen": board.fen(), 
                "score_cp": current_score_cp,
                "win_rate_white": round(win_rate_white * 100, 1),
                "win_rate_black": round(win_rate_black * 100, 1),
                "move_quality": move_quality,
                "best_move": best_move_san,
                "best_move_from": best_move_from, # <-- 【新】
                "best_move_to": best_move_to,     # <-- 【新】
                "best_move_to": best_move_to,
                "actual_move_from": actual_move_from,
                "actual_move_to": actual_move_to
            })
            
            if not is_white_move:
                move_number += 1
            is_white_move = not is_white_move
            last_score_cp = current_score_cp

    except Exception as e:
        print(f"分析過程中出錯: {e}")
        return {"error": f"分析過程中出錯: {e}"}
    finally:
        # 【新】計算 ACPL (平均每步損失)
        # 【【【 關鍵：確保下面這 6 行都有縮排！ 】】】
        if summary["White"]["move_count"] > 0:
            summary["White"]["acpl"] = round(summary["White"]["total_loss"] / summary["White"]["move_count"])
        if summary["Black"]["move_count"] > 0:
            summary["Black"]["acpl"] = round(summary["Black"]["total_loss"] / summary["Black"]["move_count"])
            
        summary["White"]["elo"] = acpl_to_elo(summary["White"]["acpl"])
        summary["Black"]["elo"] = acpl_to_elo(summary["Black"]["acpl"])

        # --- 4. 關閉引擎 ---
        engine.quit()
        print("分析完成，引擎已關閉。")

    return {"status": "success", "analysis": analysis_results, "summary": summary}

def acpl_to_elo(acpl):
    """
    將 ACPL 估算為 Elo 評分 (線性估算)
    基準: ACPL 70 = 1800 Elo
    """
    if acpl <= 0:
        acpl = 1 # 避免除以零或無效值

    # 線性公式: Elo = 1800 - (ACPL - 70) * 10
    estimated_elo = 1800 - (acpl - 70) * 10

    # 限制評分在 800 (新手) 到 3000 (頂尖) 之間
    estimated_elo = round(max(800, min(3000, estimated_elo)))

    return estimated_elo

# ---------------------------------------------------------------
# API 路由 (Endpoint) - (不變)
# ---------------------------------------------------------------
@app.route("/analyze", methods=["POST"])
def handle_analysis():
    print("後端伺服器：收到了分析請求！")
    data = request.json
    if not data or "pgn" not in data:
        return jsonify({"error": "沒有 PGN 資料"}), 400
    pgn_string = data["pgn"]
    results = analyze_pgn(pgn_string)
    if "error" in results:
        return jsonify(results), 400
    print("後端伺服器：分析完成，正在回傳結果。")
    return jsonify(results)

# ---------------------------------------------------------------
# 啟動伺服器 - (不變)
# ---------------------------------------------------------------
if __name__ == "__main__":
    app.run(debug=True, port=5000)