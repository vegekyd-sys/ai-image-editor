import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editImage } from '@/lib/skills/edit-image';
import { generateImage } from '@/lib/model-router';

vi.mock('@/lib/model-router', () => ({
  generateImage: vi.fn(),
}));

const mockedGenerateImage = vi.mocked(generateImage);

describe('editImage reference contract', () => {
  beforeEach(() => {
    mockedGenerateImage.mockReset();
    mockedGenerateImage.mockResolvedValue({
      image: 'data:image/jpeg;base64,result',
      model: 'gemini',
      fallbackUsed: false,
    });
  });

  it('keeps single-image edits on the image field', async () => {
    await editImage(
      { editPrompt: 'Make the background blue.' },
      { currentImage: 'https://example.com/current.jpg' },
    );

    expect(mockedGenerateImage).toHaveBeenCalledTimes(1);
    expect(mockedGenerateImage).toHaveBeenCalledWith(expect.objectContaining({
      image: 'https://example.com/current.jpg',
      references: undefined,
      prompt: 'Make the background blue.',
    }));
  });

  it('keeps MCP-style multi-image edits on explicit references', async () => {
    await editImage(
      { editPrompt: 'Add the person from Image 2 into Image 1.' },
      {
        currentImage: 'https://example.com/current.jpg',
        referenceImages: [
          'https://example.com/ref-1.jpg',
          'https://example.com/ref-2.jpg',
        ],
      },
    );

    expect(mockedGenerateImage).toHaveBeenCalledTimes(1);
    expect(mockedGenerateImage).toHaveBeenCalledWith(expect.objectContaining({
      image: undefined,
      references: [
        {
          url: 'https://example.com/current.jpg',
          role: 'Image 1 = 当前编辑版本【编辑基础，保持此图的构图/场景】',
        },
        {
          url: 'https://example.com/ref-1.jpg',
          role: 'Image 2 = 用户上传的参考图（第1张）【按用户指令使用，例如将此人物/物体合成到 Image 1 中】',
        },
        {
          url: 'https://example.com/ref-2.jpg',
          role: 'Image 3 = 用户上传的参考图（第2张）【按用户指令使用，例如将此人物/物体合成到 Image 1 中】',
        },
      ],
    }));
  });

  it('supports text-to-image with references', async () => {
    await editImage(
      { editPrompt: 'Create a poster inspired by the reference.' },
      { referenceImages: ['https://example.com/ref.jpg'] },
    );

    expect(mockedGenerateImage).toHaveBeenCalledTimes(1);
    expect(mockedGenerateImage).toHaveBeenCalledWith(expect.objectContaining({
      image: undefined,
      references: [
        {
          url: 'https://example.com/ref.jpg',
          role: 'Image 1 = reference image',
        },
      ],
    }));
  });

  it('passes the authenticated Codex subscription context to GPT Image 2', async () => {
    await editImage(
      { editPrompt: 'Create a polished poster.', preferredModel: 'openai' },
      {
        codexSubscription: {
          userId: 'allowed-user',
          projectId: 'project-1',
        },
      },
    );

    expect(mockedGenerateImage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai',
      codexSubscription: {
        userId: 'allowed-user',
        projectId: 'project-1',
      },
    }));
  });

  it('uses strict OpenAI text-to-image when transparent output has no source', async () => {
    await editImage(
      { editPrompt: 'Create a sticker.', background: 'transparent' },
      {},
    );

    expect(mockedGenerateImage).toHaveBeenCalledWith(expect.objectContaining({
      image: undefined,
      model: 'openai',
      background: 'transparent',
      references: undefined,
    }));
  });

  it('uses strict OpenAI image-to-image for background removal from a source', async () => {
    await editImage(
      {
        editPrompt: 'Remove the background to transparent alpha while preserving the subject.',
        background: 'transparent',
        preferredModel: 'gemini',
      },
      { currentImage: 'https://example.com/source.jpg' },
    );

    expect(mockedGenerateImage).toHaveBeenCalledWith(expect.objectContaining({
      image: 'https://example.com/source.jpg',
      model: 'openai',
      background: 'transparent',
      references: undefined,
    }));
  });
});
