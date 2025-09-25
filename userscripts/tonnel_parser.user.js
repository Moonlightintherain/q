// ==UserScript==
// @name         Tonnel Parser циклический с GM_xmlhttpRequest
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Парсит данные каждые 30 минут и отправляет на сервер на отдельный URL с Unix timestamp, обход CORS
// @match        https://market.tonnel.network/*
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    function notify(msg) {
        try {
            GM_notification({ text: msg, title: 'Tonnel Parser', timeout: 2000 });
        } catch (e) {
            console.log('[Parser notify] ' + msg);
        }
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function clickNFTButton() {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
            const divTextXs = btn.querySelector('div.text-xs');
            if (divTextXs && divTextXs.textContent.trim() === 'NFTs') {
                btn.click();
                return true;
            }
        }
        notify('Кнопка NFTs не найдена');
        return false;
    }

    function parseItems(itemEls) {
        const results = [];
        itemEls.forEach(itemEl => {
            const nameEl = itemEl.querySelector('div.whitespace-break-spaces.text-xs');
            const numEl = itemEl.querySelector('div.flex.items-center.gap-1.text-primary');
            if (nameEl && numEl) {
                const name = nameEl.textContent.trim();
                const fullNum = numEl.textContent.trim();
                const m = fullNum.match(/[\d.,]+/);
                const num = m ? m[0] : fullNum;
                results.push({ name, num });
            }
        });
        return results;
    }

    function sendDataToServer(data) {
        GM_xmlhttpRequest({
            method: "POST",
            url: "https://583edbddb673.ngrok-free.app/tonnel",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({
                timestamp: Math.floor(Date.now() / 1000), // Unix timestamp
                items: data
            }),
            onload: function(response) {
                notify(`Данные успешно отправлены: ${data.length} элементов`);
                console.log("Ответ сервера:", response.responseText);
            },
            onerror: function(err) {
                notify("Ошибка при отправке данных");
                console.error("Ошибка GM_xmlhttpRequest:", err);
            }
        });
    }

    async function collectAndSend() {
        notify('Скрипт стартует');
        await wait(500);

        const clicked = await clickNFTButton();
        if (!clicked) return;

        notify('Жду 5 секунд для прогрузки элементов...');
        await wait(5000);

        const itemEls = document.querySelectorAll('div[cmdk-item]');
        if (!itemEls.length) {
            notify('Элементы не найдены после ожидания');
            return;
        }

        const results = parseItems(Array.from(itemEls));
        console.log('Результаты:', results);
        sendDataToServer(results);
    }

    async function mainLoop() {
        await collectAndSend();
        setInterval(() => {
            location.reload();
        }, 30 * 60 * 1000); // каждые 30 минут перезагрузка страницы
    }

    window.addEventListener('load', () => setTimeout(mainLoop, 300));
})();
