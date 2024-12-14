const deBugButton = document.getElementById('deBug');
        const popupWindow = document.getElementById('popupWindow');
        const sendButton = document.getElementById('sendButton');
        const closeButton = document.getElementById('closeButton');
        /**
         * 創建粒子效果，粒子根據動作（開啟或關閉）向內或向外移動
         * @param {HTMLElement} targetElement - 目標視窗元素
         * @param {boolean} isClosing - 是否為關閉動作
         */
    
        // 顯示視窗時觸發粒子匯聚效果並淡入
        deBugButton.addEventListener('click', () => {
            // createParticles(popupWindow, false); // 開啟時粒子匯聚
            // setTimeout(() => {  
                deBugButton.classList.add('hide'); // 隱藏按鈕
                popupWindow.classList.add('show'); // 顯示視窗
            // }, 400);
        });

        // 關閉視窗時使用粒子散開效果並淡出
        function closeWindow() {
            popupWindow.classList.remove('show'); // 淡出視窗
            deBugButton.classList.remove('hide'); // 顯示按鈕
            // createParticles(popupWindow, true); // 關閉時粒子散開
        }

        closeButton.addEventListener('click', () => {
            closeWindow();
        });

        // 當淡出動畫結束後，隱藏視窗
        popupWindow.addEventListener('transitionend', (event) => {
            if (!popupWindow.classList.contains('show')) {
                // 當 opacity 完全為 0 時，確保視窗不可見
                // 這裡不需要額外處理，因為 visibility 已在 CSS 控制
            }
        });

        sendButton.addEventListener('click', () => {
            showCustomAlert('感謝協助抓蟲子！');
            closeWindow(); // 發送後自動關閉視窗
        });
