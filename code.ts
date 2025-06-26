// This shows the HTML page in "ui.html".
figma.showUI(__html__, { themeColors: true, width: 300, height: 430 }); // 플러그인 창 크기 조절


// 바이트 단위를 읽기 쉬운 형태로 변환하는 함수 (KB, MB 등) - 새로 추가된 부분
function formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Figma 선택 변경 이벤트를 수신하는 리스너 (새로 추가된 부분)
figma.on('selectionchange', async () => {
    // 선택된 노드가 없으면 미리보기를 리셋하도록 UI에 알립니다.
    if (figma.currentPage.selection.length === 0) {
        figma.ui.postMessage({ type: 'selection-image-data', imageBytes: null });
        return;
    }

    let imageNodeToPreview: RectangleNode | null = null;

    // 선택된 노드들 중에서 이미지가 포함된 Rectangle 노드를 찾습니다. (단, 첫 번째 이미지에 대해서만)
    for (const node of figma.currentPage.selection) {
      if (node.type === 'RECTANGLE' && node.fills && Array.isArray(node.fills)) {
        // 이미지가 null이 아닌 fill만 필터링
        const imageFill = (node.fills as Paint[]).find((fill): fill is ImagePaint => fill.type === 'IMAGE' && fill.imageHash !== null);
        if (imageFill) { 
          imageNodeToPreview = node;
          break; // 첫 번째 이미지 노드만 처리
        }
      }
    }

    if (imageNodeToPreview) {
        const imageFill = (imageNodeToPreview.fills as Paint[]).find((f: Paint): f is ImagePaint => f.type === 'IMAGE') as ImagePaint;
        
        if (imageFill && imageFill.imageHash !== null) { // 다시 한번 유효성 확인
            const image = figma.getImageByHash(imageFill.imageHash as string);
            if (image) {
                try {
                    const bytes = await image.getBytesAsync();
                    // UI로 이미지 데이터와 크기 정보를 전송 (미리보기용)
                    figma.ui.postMessage({
                        type: 'selection-image-data',
                        imageNodeId: imageNodeToPreview.id,
                        imageBytes: bytes,
                        width: imageNodeToPreview.width,
                        height: imageNodeToPreview.height
                    });
                } catch (e: any) {
                    console.error(`Figma: 선택된 이미지 로드 중 오류 발생 (미리보기):`, e);
                    figma.ui.postMessage({ type: 'selection-image-data', imageBytes: null }); // 오류 시 미리보기 리셋
                }
            } else {
                console.warn(`Figma: 선택된 이미지의 데이터(해시: ${imageFill.imageHash})를 찾을 수 없습니다.`);
                figma.ui.postMessage({ type: 'selection-image-data', imageBytes: null }); // 이미지 찾을 수 없을 때 리셋
            }
        } else {
            figma.ui.postMessage({ type: 'selection-image-data', imageBytes: null }); // 이미지 채우기 아닐 때 리셋
        }
    } else {
        figma.ui.postMessage({ type: 'selection-image-data', imageBytes: null }); // 이미지 노드 아닐 때 리셋
    }
});


// UI로부터 메시지를 수신하는 리스너
figma.ui.onmessage = async (msg) => {
  // 'Optimize Selected Images' 버튼 클릭 시 UI에서 요청하는 메시지 (ui.html과 타입 일치)
  if (msg.type === 'optimize-images') {
    const { resizePercentage, quality } = msg;
    console.log('Figma: UI로부터 이미지 처리 요청 수신:', { type: msg.type, resizePercentage, quality });

    const selectedNodes = figma.currentPage.selection;

    if (selectedNodes.length === 0) {
      figma.notify('최적화할 이미지가 포함된 레이어를 선택해주세요.', { error: true });
      return; // 선택된 노드가 없으면 함수 종료
    }

    let imagesToProcess: { node: RectangleNode; fill: ImagePaint }[] = []; 

    // 선택된 노드들 중에서 이미지가 포함된 Rectangle 노드를 찾습니다.
    for (const node of selectedNodes) {
      if (node.type === 'RECTANGLE' && node.fills && Array.isArray(node.fills)) {
        const imageFills = node.fills.filter((fill): fill is ImagePaint => fill.type === 'IMAGE' && fill.imageHash !== null);
        for (const fill of imageFills) {
          imagesToProcess.push({ node: node, fill: fill }); 
        }
      }
    }

    if (imagesToProcess.length === 0) {
      figma.notify('선택된 레이어에 이미지가 없습니다. 이미지로 채워진 사각형을 선택해주세요.', { error: true });
      return;
    }

    // 각 이미지에 대해 반복하며 UI로 처리 요청
    for (const { node, fill } of imagesToProcess) {
      const image = figma.getImageByHash(fill.imageHash as string); 

      if (image) {
        console.log(`[${node.name}] Figma에서 이미지 데이터 로드 시도... (hash: ${fill.imageHash})`);
        try {
          const bytes = await image.getBytesAsync(); 
          console.log(`[${node.name}] Figma에서 이미지 로드 성공! 원본 바이트 크기:`, bytes.byteLength, '바이트');
          
          figma.ui.postMessage({
            type: 'process-image-data', 
            imageNodeId: node.id, 
            imageBytes: bytes,
            resizePercentage: resizePercentage,
            quality: quality,
            width: node.width, 
            height: node.height 
          });

        } catch (e: any) { 
          console.error(`[${node.name}] Figma: getBytesAsync() 오류 발생:`, e);
          figma.notify(`오류: 이미지 "${node.name}"를 로드할 수 없습니다. ${e.message || ''}`, { error: true });
        }
      } else {
        console.warn(`Figma: 이미지 해시 ${fill.imageHash}에 해당하는 이미지를 찾을 수 없습니다.`);
      }
    }
  } 
  // UI로부터 최적화된 이미지 데이터를 수신하는 메시지 핸들러 (기존 노드 업데이트용)
  else if (msg.type === 'image-optimization-complete') {
    const { imageNodeId, optimizedBytes, originalSize } = msg; 
    console.log(`Figma: UI로부터 최적화된 이미지 수신 (Node ID: ${imageNodeId}), ${optimizedBytes.byteLength} 바이트`);

    const node = await figma.getNodeByIdAsync(imageNodeId) as RectangleNode | null; 

    if (node && node.type === 'RECTANGLE' && node.fills && Array.isArray(node.fills)) {
        try {
            const newImageHash = figma.createImage(new Uint8Array(optimizedBytes)).hash;

            const newFills: Paint[] = []; 
            for (const fill of node.fills) {
                if (fill.type === 'IMAGE') {
                    newFills.push({
                        ...fill,
                        imageHash: newImageHash
                    });
                } else {
                    newFills.push(fill); 
                }
            }
            node.fills = newFills; 

            figma.notify(`원본 용량: ${formatBytes(originalSize)} > 최적화 된 용량: ${formatBytes(optimizedBytes.byteLength)}`);
            console.log(`Figma: 이미지 "${node.name}" (ID: ${imageNodeId}) 업데이트 완료.`);

        } catch (error: any) { 
            console.error(`Figma: 노드 이미지 업데이트 중 오류 발생 (Node ID: ${imageNodeId}):`, error);
            figma.notify(`오류: 이미지 "${node.name}" 업데이트에 실패했습니다. ${error.message || ''}`, { error: true });
        }
    } else {
        console.warn(`Figma: 최적화된 이미지를 적용할 노드 ${imageNodeId}를 찾을 수 없거나 유효하지 않습니다.`);
        figma.notify(`오류: 최적화된 이미지를 적용할 노드를 찾을 수 없습니다.`, { error: true });
    }
  } 
  // UI에서 이미지 처리 중 오류 발생 시 수신하는 메시지 핸들러
  else if (msg.type === 'image-optimization-failed') {
    const { imageNodeId, error } = msg;
    console.error(`Figma: UI에서 이미지 처리 실패 (Node ID: ${imageNodeId}):`, error);
    figma.notify(`오류: 이미지 ${imageNodeId} 처리 중 문제가 발생했습니다: ${error}`, { error: true });
  }

  // 'Export to Current Frame' 버튼은 UI에서 삭제되었으므로, 해당 메시지 핸들러도 필요 없습니다.
  // else if (msg.type === 'export-to-current-frame') { /* ... */ }
  
  // UI로부터 새로운 레이어로 임포트될 최적화된 이미지 데이터를 수신하는 핸들러
  else if (msg.type === 'image-export-complete') {
    const { imageNodeId, optimizedBytes, originalSize, fileName } = msg; 
    console.log(`Figma: UI로부터 Export용 최적화 이미지 수신 (Node ID: ${imageNodeId}), ${optimizedBytes.byteLength} 바이트`);

    try {
        const newImageHash = figma.createImage(new Uint8Array(optimizedBytes)).hash;
        
        const newRectangle = figma.createRectangle();
        newRectangle.name = `Optimized Export (${fileName || imageNodeId.split(':').pop()})`; 
        newRectangle.fills = [{
            type: 'IMAGE',
            imageHash: newImageHash,
            scaleMode: 'FIT' 
        }];

        const originalNode = await figma.getNodeByIdAsync(imageNodeId) as RectangleNode | null; 
        if (originalNode) {
            newRectangle.x = originalNode.x + originalNode.width + 20; 
            newRectangle.y = originalNode.y;
            newRectangle.resize(originalNode.width, originalNode.height); 
        } else {
            newRectangle.x = 0;
            newRectangle.y = 0;
            newRectangle.resize(100, 100); 
        }

        figma.currentPage.appendChild(newRectangle); 
        figma.currentPage.selection = [newRectangle]; 
        figma.viewport.scrollAndZoomIntoView([newRectangle]); 

        figma.notify(`내보내기 완료: ${fileName || '이미지'} (원본: ${formatBytes(originalSize)} > 최적화: ${formatBytes(optimizedBytes.byteLength)})`);
        console.log(`Figma: 새 이미지 레이어 "${newRectangle.name}" 생성 및 임포트 완료.`);

    } catch (error: any) { 
        console.error(`Figma: 새 이미지 레이어 생성 중 오류:`, error);
        figma.notify(`오류: 현재 프레임에 이미지를 임포트하지 못했습니다. ${error.message || ''}`, { error: true });
    }
  }
  // UI에서 내보내기용 이미지 처리 중 오류 발생 시 수신하는 메시지 핸들러
  else if (msg.type === 'image-export-failed') {
    const { imageNodeId, error } = msg;
    console.error(`Figma: UI에서 Export용 이미지 처리 실패 (Node ID: ${imageNodeId}):`, error);
    figma.notify(`오류: Export할 이미지 ${imageNodeId} 처리 중 문제가 발생했습니다: ${error}`, { error: true });
  }
  
  // 'Export to External Folder' 버튼 클릭 시 UI에서 요청하는 메시지
  else if (msg.type === 'export-to-folder') {
    const resizePercentage = (msg as any).resizePercentage !== undefined ? (msg as any).resizePercentage : 100;
    const quality = (msg as any).quality !== undefined ? (msg as any).quality : 80;

    console.log('Figma: UI로부터 메시지 수신: Export to External Folder', { resizePercentage, quality });
    const selectedNodes = figma.currentPage.selection;
    let imageNodeToExport: RectangleNode | undefined; 

    for (const node of selectedNodes) {
        if (node.type === 'RECTANGLE' && node.fills && Array.isArray(node.fills)) {
            const imageFill = (node.fills as Paint[]).find((f: Paint): f is ImagePaint => f.type === 'IMAGE'); 
            if (imageFill && imageFill.imageHash !== null) { 
                imageNodeToExport = node;
                break; 
            }
        }
    }

    if (!imageNodeToExport) {
        figma.notify('내보낼 이미지를 선택해주세요.', { error: true });
        return;
    }
    
    const imageFill = (imageNodeToExport.fills as Paint[]).find((f: Paint): f is ImagePaint => f.type === 'IMAGE');
    
    if (!imageFill || imageFill.imageHash === null) { 
        figma.notify('선택된 레이어에 유효한 이미지 데이터가 없습니다.', { error: true });
        return;
    }

    const image = figma.getImageByHash(imageFill.imageHash as string); 
    
    if (image) {
        console.log(`[${imageNodeToExport.name}] Figma: 외부 Export용 이미지 데이터 로드 시도...`);
        try {
            const bytes = await image.getBytesAsync(); 
            figma.ui.postMessage({
                type: 'request-external-export', // UI가 처리할 메시지 타입
                imageBytes: bytes,
                fileName: `${imageNodeToExport.name}_optimized.jpg`, // 저장될 파일 이름 제안
                resizePercentage: resizePercentage, // UI에서 받은 값 전달
                quality: quality, // UI에서 받은 값 전달
                width: imageNodeToExport.width,
                height: imageNodeToExport.height
            });

        } catch (e: any) { 
            console.error(`Figma: 외부 Export용 이미지 로드 중 오류:`, e);
            figma.notify(`오류: 외부 Export할 이미지를 로드할 수 없습니다. ${e.message || ''}`, { error: true });
        }
    } else {
        console.warn(`Figma: 선택된 이미지의 데이터(해시: ${imageFill.imageHash})를 찾을 수 없습니다.`);
        figma.notify('선택된 이미지 데이터를 찾을 수 없습니다.', { error: true });
    }
  }
};