fetch('api/veri')
    .then(response => response.json())
    .then(data => {
        const tablo = document.createElement('table'); // Tablo oluştur
        tablo.classList.add('table'); // Bootstrap tablo stili ekle
        const thead = document.createElement('thead'); // Tablo başlığı oluştur
        const tbody = document.createElement('tbody'); // Tablo gövdesi oluştur

        // Tablo başlığını oluştur
        const baslikRow = document.createElement('tr');
        ['Dosya Adı', 'Boyut', 'Değiştirilme'].forEach(baslik => {
            const baslikCell = document.createElement('th');
            baslikCell.textContent = baslik;
            baslikRow.appendChild(baslikCell);
        });
        thead.appendChild(baslikRow);

        // Verileri tabloya ekle
        data.forEach(ornek => {
            const satir = document.createElement('tr');
            ['id', 'isim', 'deger'].forEach(anahtar => {
                const hucre = document.createElement('td');
                hucre.textContent = ornek[anahtar];
                satir.appendChild(hucre);
            });
            tbody.appendChild(satir);
        });

        // Tabloyu tamamla ve HTML'e ekle
        tablo.appendChild(thead);
        tablo.appendChild(tbody);
        document.getElementById('table_divi').appendChild(tablo);
    });

        function serverConnFunc() {
            var formURL = "serverconnection.html";
            var win = window.open(formURL, "_blank", "resizable=yes,width=600,height=600");
            if (!win) {
                alert("Popup engellendi. Lütfen popupları etkinleştirin.");
            }
        }
        
        
        

    